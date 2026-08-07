import type {AccountResponse} from '@tabstop/contract';
import {useQuery, type UseQueryResult} from '@tanstack/react-query';
import {ApiError, request} from '@/api/client';

export const sessionKeys = {
  me: ['session', 'me'] as const,
};

/**
 * Who is signed in, or `null`.
 *
 * `GET /api/me` is the ONLY way to know. The session is an httpOnly cookie, so
 * JavaScript never sees it - there is no "is there a token in storage" check to
 * make, and no way to answer this question without a round trip.
 *
 * A 401 is mapped to `null` rather than left as an error, because it is not
 * one: "nobody is signed in" is a normal answer that `RequireAuth` acts on. A
 * 500 stays an error, so a broken backend does not silently look like a logged
 * out user and bounce everyone to the home page.
 */
export const useSession = (): UseQueryResult<AccountResponse | null, Error> =>
  useQuery({
    queryKey: sessionKeys.me,
    queryFn: async () => {
      try {
        return await request<AccountResponse>('/api/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
