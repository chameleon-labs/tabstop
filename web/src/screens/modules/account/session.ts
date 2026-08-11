import type {AccountResponse} from '@tabstop/contract';
import {queryOptions, useQuery, type QueryClient, type UseQueryResult} from '@tanstack/react-query';
import {ApiError, request} from '@/api/client';

export const sessionKeys = {
  me: ['session', 'me'] as const,
};

export const sessionQueryOptions = queryOptions({
  queryKey: sessionKeys.me,
  // Declared here rather than left to whichever client is in scope. A route
  // loader and the header both ask for this answer, milliseconds apart, and
  // with no stale window the second one is a second round trip. Freshness does
  // not rest on this: `refreshSession` invalidates on login and logout.
  staleTime: 30_000,
  queryFn: async (): Promise<AccountResponse | null> => {
    try {
      return await request<AccountResponse>('/api/me');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return null;
      }
      throw error;
    }
  },
});

/**
 * Who is signed in, or `null`.
 *
 * `GET /api/me` is the ONLY way to know. The session is an httpOnly cookie, so
 * JavaScript never sees it - there is no "is there a token in storage" check to
 * make, and no way to answer this question without a round trip.
 *
 * A 401 is mapped to `null` rather than left as an error, because it is not
 * one: "nobody is signed in" is a normal answer the route guards act on. A
 * 500 stays an error, so a broken backend does not silently look like a logged
 * out user and bounce everyone to the home page.
 */
export const refreshSession = async (queryClient: QueryClient): Promise<AccountResponse | null> => {
  await queryClient.invalidateQueries({queryKey: sessionKeys.me, exact: true, refetchType: 'none'});
  return await queryClient.fetchQuery(sessionQueryOptions);
};

export const useSession = (options: {enabled?: boolean} = {}): UseQueryResult<AccountResponse | null, Error> =>
  useQuery({...sessionQueryOptions, enabled: options.enabled ?? true});
