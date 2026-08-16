import type {PageHistoryResponse} from '@tabstop/contract';
import {useQuery, type UseQueryResult} from '@tanstack/react-query';
import {request} from '@/api/client';

export const HISTORY_WINDOWS = [30, 90, 365] as const;

export type HistoryWindow = (typeof HISTORY_WINDOWS)[number];

export const DEFAULT_HISTORY_WINDOW: HistoryWindow = 90;

/**
 * Anything the server would clamp or reject becomes the default rather than
 * being passed on, so the control and the chart cannot describe two windows.
 */
export const historyWindowFrom = (value: string | null): HistoryWindow =>
  HISTORY_WINDOWS.find((candidate) => String(candidate) === value) ?? DEFAULT_HISTORY_WINDOW;

export const pageHistoryKeys = {
  all: ['page-history'] as const,
  detail: (pageId: string, days: number) => ['page-history', pageId, days] as const,
};

export const usePageHistory = (
  pageId: string | undefined,
  days: HistoryWindow,
): UseQueryResult<PageHistoryResponse, Error> =>
  useQuery({
    queryKey: pageHistoryKeys.detail(pageId ?? '', days),
    queryFn: async () =>
      await request<PageHistoryResponse>(`/api/pages/${encodeURIComponent(pageId ?? '')}/history?days=${days}`),
    enabled: pageId !== undefined,
  });
