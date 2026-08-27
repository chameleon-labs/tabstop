import {QueryClient} from '@tanstack/react-query';
import {ApiError} from './client';

const retry = (failureCount: number, error: unknown): boolean => {
  if (error instanceof ApiError && error.status < 500) {
    return false;
  }
  return failureCount < 2;
};

export const makeQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: {retry: false},
    },
  });
