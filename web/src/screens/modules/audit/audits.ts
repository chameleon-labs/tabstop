import type {AuditResultResponse, RequestAuditResponse} from '@tabstop/contract';
import {useMutation, useQuery, type UseMutationResult, type UseQueryResult} from '@tanstack/react-query';
import {post, request} from '@/api/client';

export const auditKeys = {
  detail: (auditId: string) => ['audits', auditId] as const,
};

/**
 * Used only when nothing better is known - a share link opened cold never saw
 * the `POST` that carries the real number. `pollAfterMs` comes from the server
 * precisely so the interval can be widened without a frontend deploy, so
 * anywhere the response is available, pass it.
 */
export const FALLBACK_POLL_AFTER_MS = 2000;

const isSettled = (status: AuditResultResponse['status']): boolean => status === 'done' || status === 'failed';

export type UseAuditOptions = {
  /** From `POST /api/audits`. Falls back to `FALLBACK_POLL_AFTER_MS`. */
  pollAfterMs?: number;
  /** Skip the query entirely, e.g. before an audit has been requested. */
  enabled?: boolean;
};

/**
 * One audit, polled until it reaches a terminal state and then left alone.
 *
 * The interval is a function of the last response rather than a `setInterval`
 * somewhere in a component: a hand-rolled timer has to be cleared on unmount,
 * on `auditId` change and on completion, and getting any of those wrong leaves
 * a tab polling a finished audit forever. Returning `false` from here is the
 * whole stop condition.
 */
export const useAudit = (
  auditId: string | undefined,
  options: UseAuditOptions = {},
): UseQueryResult<AuditResultResponse, Error> => {
  const pollAfterMs = options.pollAfterMs ?? FALLBACK_POLL_AFTER_MS;

  return useQuery({
    queryKey: auditKeys.detail(auditId ?? ''),
    queryFn: async () => await request<AuditResultResponse>(`/api/audits/${encodeURIComponent(auditId ?? '')}`),
    enabled: (options.enabled ?? true) && auditId !== undefined,
    // A running audit is stale the moment it arrives; that is what polling means.
    staleTime: 0,
    refetchInterval: (query) => {
      // A query that has ERRORED stops polling, and this is not the same
      // condition as having no data. TanStack Query keeps the last successful
      // body when a later fetch fails, so `data.status` stays `running` and the
      // interval kept firing indefinitely - the screen said "Lost track of that
      // audit" and offered a Try again button while silently retrying behind
      // it, several times a second, for as long as the tab stayed open. A
      // button that claims to be the way to retry must be the way to retry.
      if (query.state.status === 'error') {
        return false;
      }

      const status = query.state.data?.status;
      if (status === undefined) {
        return false;
      }
      return isSettled(status) ? false : pollAfterMs;
    },
  });
};

/**
 * Anonymous by design - a one-off audit with no signup is the product's hook -
 * and rate limited per IP, so a 429 here is an expected outcome rather than an
 * error to hide. `rateLimitOf` in `client.ts` turns it into something a screen
 * can render.
 */
export const useRequestAudit = (): UseMutationResult<RequestAuditResponse, Error, string> =>
  useMutation({
    mutationFn: async (url: string) => await post<RequestAuditResponse>('/api/audits', {url}),
  });
