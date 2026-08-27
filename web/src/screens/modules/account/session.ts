import type {AccountResponse} from '@tabstop/contract';
import {queryOptions, useQuery, type QueryClient, type UseQueryResult} from '@tanstack/react-query';
import {ApiError, request} from '@/api/client';

export const sessionKeys = {
  me: ['session', 'me'] as const,
};

export const sessionQueryOptions = queryOptions({
  queryKey: sessionKeys.me,
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

export const refreshSession = async (queryClient: QueryClient): Promise<AccountResponse | null> => {
  await queryClient.invalidateQueries({queryKey: sessionKeys.me, exact: true, refetchType: 'none'});
  return await queryClient.fetchQuery(sessionQueryOptions);
};

export const useSession = (options: {enabled?: boolean} = {}): UseQueryResult<AccountResponse | null, Error> =>
  useQuery({...sessionQueryOptions, enabled: options.enabled ?? true});
