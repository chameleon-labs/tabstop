import type {AuditResultResponse, RequestAuditResponse} from '@tabstop/contract';
import {useMutation, useQuery, type UseMutationResult, type UseQueryResult} from '@tanstack/react-query';
import {post, request} from '@/api/client';

export const auditKeys = {
  detail: (auditId: string) => ['audits', auditId] as const,
};

export const FALLBACK_POLL_AFTER_MS = 2000;

const isSettled = (status: AuditResultResponse['status']): boolean => status === 'done' || status === 'failed';

export type UseAuditOptions = {
  pollAfterMs?: number | undefined;
  enabled?: boolean;
};

export const useAudit = (
  auditId: string | undefined,
  options: UseAuditOptions = {},
): UseQueryResult<AuditResultResponse, Error> => {
  const pollAfterMs = options.pollAfterMs ?? FALLBACK_POLL_AFTER_MS;

  return useQuery({
    queryKey: auditKeys.detail(auditId ?? ''),
    queryFn: async () => await request<AuditResultResponse>(`/api/audits/${encodeURIComponent(auditId ?? '')}`),
    enabled: (options.enabled ?? true) && auditId !== undefined,
    staleTime: 0,
    refetchInterval: (query) => {
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

export const useRequestAudit = (): UseMutationResult<RequestAuditResponse, Error, string> =>
  useMutation({
    mutationFn: async (url: string) => await post<RequestAuditResponse>('/api/audits', {url}),
  });
