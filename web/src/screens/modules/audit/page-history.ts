import type {PageHistoryResponse} from '@tabstop/contract';
import {useQuery, type UseQueryResult} from '@tanstack/react-query';
import {request} from '@/api/client';

export const HISTORY_WINDOWS = [30, 90, 365] as const;

export type HistoryWindow = (typeof HISTORY_WINDOWS)[number];

export const DEFAULT_HISTORY_WINDOW: HistoryWindow = 90;

export const historyWindowFrom = (value: string | null): HistoryWindow =>
  HISTORY_WINDOWS.find((candidate) => String(candidate) === value) ?? DEFAULT_HISTORY_WINDOW;

export const pageHistoryKeys = {
  all: ['page-history'] as const,
  detail: (pageId: string, days: number) => ['page-history', pageId, days] as const,
};

export const IN_FLIGHT_HISTORY_POLL_MS = 2_000;

const hasInFlightPoint = (data: PageHistoryResponse | undefined): boolean =>
  data?.points.some(({status}) => status === 'queued' || status === 'running') ?? false;

export const usePageHistory = (
  pageId: string | undefined,
  days: HistoryWindow,
): UseQueryResult<PageHistoryResponse, Error> =>
  useQuery({
    queryKey: pageHistoryKeys.detail(pageId ?? '', days),
    queryFn: async ({client, queryKey}) =>
      await request<PageHistoryResponse>(
        `/api/pages/${encodeURIComponent(pageId ?? '')}/history?days=${days}`,
        hasInFlightPoint(client.getQueryData<PageHistoryResponse>(queryKey)) ? {cache: 'no-store'} : {},
      ),
    enabled: pageId !== undefined,
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      if (query.state.status === 'error' || query.state.data === undefined) {
        return false;
      }

      return hasInFlightPoint(query.state.data) ? IN_FLIGHT_HISTORY_POLL_MS : false;
    },
  });
