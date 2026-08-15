import type {AddPageResponse, LoadPagesResponse, UpdatePageResponse} from '@tabstop/contract';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {post, request} from '@/api/client';

/** Matches the audit fallback: what "work is happening" is worth costing. */
export const ACTIVE_PAGE_POLL_MS = 2_000;
export const IDLE_PAGE_POLL_MS = 60_000;

export const pageKeys = {
  all: ['pages'] as const,
  list: () => ['pages', 'list'] as const,
};

export type MonitoringChange = {pageId: string; monitoringEnabled: boolean};
export type DeletePageVariables = {pageId: string};

const pagePath = (pageId: string): string => `/api/pages/${encodeURIComponent(pageId)}`;

const hasActiveAudit = (data: LoadPagesResponse | undefined): boolean =>
  data?.pages.some(({latestAudit}) => latestAudit?.status === 'queued' || latestAudit?.status === 'running') ?? false;

/**
 * The monitored list, polled at a rate the list itself decides.
 *
 * A query that has ERRORED returns no interval at all, which is not the same
 * condition as having no data yet: TanStack keeps the last successful body, so
 * an outage would otherwise become one request every two seconds for as long
 * as the tab stays open, behind a Retry button that claims to be the way back.
 */
export const useMonitoredPages = (): UseQueryResult<LoadPagesResponse, Error> =>
  useQuery({
    queryKey: pageKeys.list(),
    queryFn: async () => await request<LoadPagesResponse>('/api/pages'),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      if (query.state.status === 'error' || query.state.data === undefined) {
        return false;
      }

      return hasActiveAudit(query.state.data) ? ACTIVE_PAGE_POLL_MS : IDLE_PAGE_POLL_MS;
    },
  });

export const useAddMonitoredPage = (): UseMutationResult<AddPageResponse, Error, string> => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (url: string) => await post<AddPageResponse>('/api/pages', {url}),
    // No fabricated row: the summary carries a domain, a latest audit and a
    // history that only the server can describe.
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: pageKeys.list(), exact: true});
    },
  });
};

type MonitoringContext = {previousMonitoringEnabled: boolean | undefined};

const withMonitoring = (
  current: LoadPagesResponse | undefined,
  pageId: string,
  monitoringEnabled: boolean,
): LoadPagesResponse | undefined =>
  current === undefined
    ? current
    : {
        ...current,
        pages: current.pages.map((page) => (page.id === pageId ? {...page, monitoringEnabled} : page)),
      };

/**
 * Optimistic, because a toggle that waits for a round trip feels broken.
 *
 * The rollback restores one page's previous value rather than the whole list:
 * another row may have changed successfully while this request was in flight,
 * and a snapshot of the entire response would undo that too.
 */
export const useSetPageMonitoring = (): UseMutationResult<
  UpdatePageResponse,
  Error,
  MonitoringChange,
  MonitoringContext
> => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({pageId, monitoringEnabled}: MonitoringChange) =>
      await request<UpdatePageResponse>(pagePath(pageId), {
        method: 'PATCH',
        body: JSON.stringify({monitoringEnabled}),
      }),
    onMutate: async ({pageId, monitoringEnabled}) => {
      await queryClient.cancelQueries({queryKey: pageKeys.list(), exact: true});
      const previous = queryClient.getQueryData<LoadPagesResponse>(pageKeys.list());
      queryClient.setQueryData<LoadPagesResponse>(pageKeys.list(), (current) =>
        withMonitoring(current, pageId, monitoringEnabled),
      );

      return {previousMonitoringEnabled: previous?.pages.find((page) => page.id === pageId)?.monitoringEnabled};
    },
    onError: (_error, {pageId}, context) => {
      const restored = context?.previousMonitoringEnabled;
      if (restored === undefined) {
        return;
      }

      queryClient.setQueryData<LoadPagesResponse>(pageKeys.list(), (current) =>
        withMonitoring(current, pageId, restored),
      );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({queryKey: pageKeys.list(), exact: true});
    },
  });
};

/**
 * Deliberately not optimistic. Removal cascades through audits and share
 * links with no undo behind it, so the row may not disappear before the
 * server says it has.
 */
export const useDeleteMonitoredPage = (): UseMutationResult<null, Error, DeletePageVariables> => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({pageId}: DeletePageVariables) => await request<null>(pagePath(pageId), {method: 'DELETE'}),
    onSuccess: (_result, {pageId}) => {
      queryClient.setQueryData<LoadPagesResponse>(pageKeys.list(), (current) =>
        current === undefined
          ? current
          : {
              ...current,
              pages: current.pages.filter((page) => page.id !== pageId),
              used: Math.max(0, current.used - 1),
            },
      );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({queryKey: pageKeys.list(), exact: true});
    },
  });
};
