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

export const IN_FLIGHT_HISTORY_POLL_MS = 2_000;

/**
 * A window is not immutable. The endpoint returns every audit in it whatever
 * became of each, so a queued or running point acquires its status and score
 * later - and nothing else on this screen would ever ask again.
 */
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
        // `private, max-age=60` is true of a finished audit and wrong about an
        // unfinished one: every poll inside that minute would be answered from
        // the browser's own cache with the same in-flight body.
        hasInFlightPoint(client.getQueryData<PageHistoryResponse>(queryKey)) ? {cache: 'no-store'} : {},
      ),
    enabled: pageId !== undefined,
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      // A query that has ERRORED stops, and that is not the same condition as
      // having no data: TanStack keeps the last successful window, so the chart
      // still shows a running point while the endpoint is broken.
      if (query.state.status === 'error' || query.state.data === undefined) {
        return false;
      }

      return hasInFlightPoint(query.state.data) ? IN_FLIGHT_HISTORY_POLL_MS : false;
    },
  });
