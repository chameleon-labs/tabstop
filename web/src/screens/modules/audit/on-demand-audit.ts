import type {PageAuditConflictCode, RequestAuditResponse} from '@tabstop/contract';
import {useMutation, useQueryClient, type UseMutationResult} from '@tanstack/react-query';
import {isApiError, request} from '@/api/client';
import {UNREACHABLE_REQUEST} from './failure';
import {pageHistoryKeys} from './page-history';
import {pageKeys} from './monitored-pages';
import {nextAuditTime} from './page-time';

const CODES: Record<PageAuditConflictCode, PageAuditConflictCode> = {
  audit_in_flight: 'audit_in_flight',
  on_demand_audit_spent: 'on_demand_audit_spent',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const conflictCodeOf = (body: unknown): PageAuditConflictCode | null => {
  if (!isRecord(body) || typeof body['code'] !== 'string') {
    return null;
  }

  return body['code'] in CODES ? (body['code'] as PageAuditConflictCode) : null;
};

const resetAtOf = (body: unknown): string | null => {
  if (!isRecord(body) || typeof body['resetAt'] !== 'string') {
    return null;
  }

  return Number.isNaN(Date.parse(body['resetAt'])) ? null : body['resetAt'];
};

export type AuditRefusal = {
  message: string;
  retryable: boolean;
};

export const describeAuditRefusal = (
  error: unknown,
  now: number = Date.now(),
  locale?: string,
  timeZone?: string,
): AuditRefusal | null => {
  if (error === null || error === undefined) {
    return null;
  }

  if (!isApiError(error)) {
    return {message: UNREACHABLE_REQUEST, retryable: true};
  }

  const code = conflictCodeOf(error.body);
  if (code === null) {
    return {message: error.message, retryable: error.status >= 500};
  }

  const resetAt = resetAtOf(error.body);
  if (code === 'on_demand_audit_spent' && resetAt !== null) {
    return {
      message: `${error.message}. The next one is available ${nextAuditTime(resetAt, now, locale, timeZone)}`,
      retryable: false,
    };
  }

  return {message: error.message, retryable: code === 'audit_in_flight'};
};

export const useRequestPageAudit = (
  pageId: string | undefined,
): UseMutationResult<RequestAuditResponse, Error, void> => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (pageId === undefined) {
        throw new Error('No page to audit');
      }

      return await request<RequestAuditResponse>(`/api/pages/${encodeURIComponent(pageId)}/audits`, {method: 'POST'});
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({queryKey: pageKeys.list(), exact: true}),
        queryClient.invalidateQueries({queryKey: pageHistoryKeys.all}),
      ]);
    },
  });
};
