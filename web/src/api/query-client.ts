import {QueryClient} from '@tanstack/react-query';
import {ApiError} from './client';

/**
 * Retry the failures that might succeed, and only those.
 *
 * A 4xx is the server's considered answer - retrying a 400 sends the same
 * invalid body again, and retrying a 429 is actively harmful, since the bucket
 * is empty and each attempt is another denial for whoever shares that address.
 * A `fetch` rejection (offline, DNS, connection refused) is not an ApiError at
 * all and does get retried, because it may genuinely be transient.
 */
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
        // Audit data changes only when a re-audit lands, and the screens that
        // want fresher data than this poll for it explicitly.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: {retry: false},
    },
  });
