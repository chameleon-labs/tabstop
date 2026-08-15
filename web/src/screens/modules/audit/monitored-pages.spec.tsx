import {QueryClient, QueryClientProvider, focusManager} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {AuditStatus, LoadPagesResponse, PageSummary} from '@tabstop/contract';
import {jsonResponse} from '@/test/http';
import {
  ACTIVE_PAGE_POLL_MS,
  IDLE_PAGE_POLL_MS,
  pageKeys,
  useAddMonitoredPage,
  useDeleteMonitoredPage,
  useMonitoredPages,
  useSetPageMonitoring,
} from './monitored-pages';

const page = (id: string, overrides: Partial<PageSummary> = {}): PageSummary => ({
  id,
  url: `https://example.test/${id}`,
  monitoringEnabled: true,
  createdAt: '2026-08-01T10:00:00.000Z',
  domain: 'example.test',
  latestAudit: {
    auditId: `audit-${id}`,
    status: 'done',
    score: 74,
    countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
    createdAt: '2026-08-15T10:00:00.000Z',
    completedAt: '2026-08-15T10:01:00.000Z',
    error: null,
  },
  score: 74,
  previousScore: 86,
  history: [{score: 74, at: '2026-08-15T10:00:00.000Z'}],
  ...overrides,
});

const withStatus = (id: string, status: AuditStatus): PageSummary => {
  const base = page(id);
  return {...base, latestAudit: {...base.latestAudit!, status}};
};

const list = (pages: PageSummary[], used = pages.length): LoadPagesResponse => ({pages, limit: 10, used});

const deferred = <T,>(): {promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void} => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {promise, resolve, reject};
};

const harness = (): {client: QueryClient; wrapper: React.FC<{children: React.ReactNode}>} => {
  const client = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });

  return {
    client,
    wrapper: ({children}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  };
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({shouldAdvanceTime: true});
  focusManager.setFocused(true);
  fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, list([page('page-1')]))));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useMonitoredPages', () => {
  it('asks the pages endpoint with the session cookie', async () => {
    const {wrapper} = harness();
    renderHook(() => useMonitoredPages(), {wrapper});

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/pages', expect.objectContaining({credentials: 'include'}));
    });
  });

  it('polls quickly while any audit is still running', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, list([withStatus('page-1', 'running')]))));
    const {wrapper} = harness();
    renderHook(() => useMonitoredPages(), {wrapper});

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_PAGE_POLL_MS);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('polls quickly while an audit is only queued', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, list([withStatus('page-1', 'queued')]))));
    const {wrapper} = harness();
    renderHook(() => useMonitoredPages(), {wrapper});

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_PAGE_POLL_MS);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('backs off to a slow poll once nothing is running', async () => {
    // Two seconds forever would be a request per tab per two seconds for a
    // list that changes nightly.
    const {wrapper} = harness();
    renderHook(() => useMonitoredPages(), {wrapper});

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_PAGE_POLL_MS * 2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_PAGE_POLL_MS);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('stops polling a tab nobody is looking at', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, list([withStatus('page-1', 'running')]))));
    const {wrapper} = harness();
    renderHook(() => useMonitoredPages(), {wrapper});

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      focusManager.setFocused(false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_PAGE_POLL_MS * 3);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes when the tab is looked at again, unlike the app default', async () => {
    const {wrapper} = harness();
    renderHook(() => useMonitoredPages(), {wrapper});

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      focusManager.setFocused(false);
    });
    act(() => {
      focusManager.setFocused(true);
    });

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it('stops polling when a loaded list starts failing', async () => {
    // The dangerous case, and the one "no data yet" does not cover: TanStack
    // keeps the last successful body, so the rows still say an audit is
    // running and the interval would fire against a broken endpoint forever.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, list([withStatus('page-1', 'running')]))));
    const {client, wrapper} = harness();
    const {result} = renderHook(() => useMonitoredPages(), {wrapper});

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Server error'})));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_PAGE_POLL_MS);
    });

    // Read from the cache, not from `isError`: the observer keeps reporting
    // success while it still has rows to show, which is the whole reason the
    // interval has to consult the query state instead.
    const query = client.getQueryCache().find({queryKey: pageKeys.list()});
    await waitFor(() => {
      expect(query?.state.status).toBe('error');
    });
    expect(query?.state.data).toBeDefined();

    const afterFailure = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_PAGE_POLL_MS * 5);
    });

    expect(fetchMock).toHaveBeenCalledTimes(afterFailure);
  });

  it('stops polling after a failure and waits to be asked again', async () => {
    // Polling through an outage turns one broken request into a request every
    // two seconds for as long as the tab stays open.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Server error'})));
    const {wrapper} = harness();
    const {result} = renderHook(() => useMonitoredPages(), {wrapper});

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    const afterFailure = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_PAGE_POLL_MS + ACTIVE_PAGE_POLL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(afterFailure);

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, list([page('page-1')]))));
    await act(async () => {
      await result.current.refetch();
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFailure);
  });
});

describe('useAddMonitoredPage', () => {
  it('sends the canonical url and then re-reads the list', async () => {
    const {client, wrapper} = harness();
    client.setQueryData(pageKeys.list(), list([]));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(201, {
          id: 'page-2',
          url: 'https://example.test/new',
          monitoringEnabled: true,
          createdAt: '2026-08-15T12:00:00.000Z',
          firstAuditId: 'audit-2',
        }),
      ),
    );

    const {result} = renderHook(() => useAddMonitoredPage(), {wrapper});
    await act(async () => {
      await result.current.mutateAsync('https://example.test/new');
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pages',
      expect.objectContaining({method: 'POST', body: JSON.stringify({url: 'https://example.test/new'})}),
    );
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({queryKey: pageKeys.list()}));
  });

  it('invents no row of its own, leaving the server to describe what it made', async () => {
    const {client, wrapper} = harness();
    client.setQueryData(pageKeys.list(), list([]));
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(201, {
          id: 'page-2',
          url: 'https://example.test/new',
          monitoringEnabled: true,
          createdAt: '2026-08-15T12:00:00.000Z',
          firstAuditId: 'audit-2',
        }),
      ),
    );

    const {result} = renderHook(() => useAddMonitoredPage(), {wrapper});
    await act(async () => {
      await result.current.mutateAsync('https://example.test/new');
    });

    expect(client.getQueryData<LoadPagesResponse>(pageKeys.list())?.pages).toEqual([]);
  });
});

describe('useSetPageMonitoring', () => {
  it('sends the change and shows it before the server answers', async () => {
    const pending = deferred<Response>();
    const {client, wrapper} = harness();
    client.setQueryData(pageKeys.list(), list([page('page-1'), page('page-2')]));
    fetchMock.mockImplementation(() => pending.promise);

    const {result} = renderHook(() => useSetPageMonitoring(), {wrapper});
    act(() => {
      result.current.mutate({pageId: 'page-1', monitoringEnabled: false});
    });

    await waitFor(() => {
      expect(client.getQueryData<LoadPagesResponse>(pageKeys.list())?.pages[0]?.monitoringEnabled).toBe(false);
    });
    expect(client.getQueryData<LoadPagesResponse>(pageKeys.list())?.pages[1]?.monitoringEnabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pages/page-1',
      expect.objectContaining({method: 'PATCH', body: JSON.stringify({monitoringEnabled: false})}),
    );

    pending.resolve(jsonResponse(200, {id: 'page-1', url: 'x', monitoringEnabled: false, createdAt: 'x'}));
  });

  it('rolls back only the row that failed, leaving a concurrent change alone', async () => {
    // Restoring the whole list would discard whatever else succeeded while
    // this request was in flight.
    const failing = deferred<Response>();
    const {client, wrapper} = harness();
    client.setQueryData(pageKeys.list(), list([page('page-1'), page('page-2')]));
    fetchMock.mockImplementation((path: string) =>
      path === '/api/pages/page-1'
        ? failing.promise
        : Promise.resolve(jsonResponse(200, {id: 'page-2', url: 'x', monitoringEnabled: false, createdAt: 'x'})),
    );

    const {result} = renderHook(() => useSetPageMonitoring(), {wrapper});
    const second = renderHook(() => useSetPageMonitoring(), {wrapper});

    act(() => {
      result.current.mutate({pageId: 'page-1', monitoringEnabled: false});
    });
    act(() => {
      second.result.current.mutate({pageId: 'page-2', monitoringEnabled: false});
    });

    await waitFor(() => {
      expect(client.getQueryData<LoadPagesResponse>(pageKeys.list())?.pages[1]?.monitoringEnabled).toBe(false);
    });

    await act(async () => {
      failing.resolve(jsonResponse(500, {error: 'Server error'}));
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(client.getQueryData<LoadPagesResponse>(pageKeys.list())?.pages[0]?.monitoringEnabled).toBe(true);
    });
    expect(client.getQueryData<LoadPagesResponse>(pageKeys.list())?.pages[1]?.monitoringEnabled).toBe(false);
  });

  it('lets the server have the last word once the request settles', async () => {
    const {client, wrapper} = harness();
    client.setQueryData(pageKeys.list(), list([page('page-1')]));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, {id: 'page-1', url: 'x', monitoringEnabled: false, createdAt: 'x'})),
    );

    const {result} = renderHook(() => useSetPageMonitoring(), {wrapper});
    await act(async () => {
      await result.current.mutateAsync({pageId: 'page-1', monitoringEnabled: false});
    });

    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({queryKey: pageKeys.list()}));
  });
});

describe('useDeleteMonitoredPage', () => {
  it('removes nothing until the server confirms it', async () => {
    // There is no undo behind this, so an optimistic delete that fails would
    // have shown the user a page vanishing that still exists.
    const pending = deferred<Response>();
    const {client, wrapper} = harness();
    client.setQueryData(pageKeys.list(), list([page('page-1'), page('page-2')]));
    fetchMock.mockImplementation(() => pending.promise);

    const {result} = renderHook(() => useDeleteMonitoredPage(), {wrapper});
    act(() => {
      result.current.mutate({pageId: 'page-1'});
    });

    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
    });
    expect(client.getQueryData<LoadPagesResponse>(pageKeys.list())?.pages).toHaveLength(2);

    pending.resolve(new Response(null, {status: 204}));
  });

  it('drops the row and the count together once it is gone', async () => {
    const {client, wrapper} = harness();
    client.setQueryData(pageKeys.list(), list([page('page-1'), page('page-2')]));
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, {status: 204})));

    const {result} = renderHook(() => useDeleteMonitoredPage(), {wrapper});
    await act(async () => {
      await result.current.mutateAsync({pageId: 'page-1'});
    });

    const data = client.getQueryData<LoadPagesResponse>(pageKeys.list());
    expect(data?.pages.map(({id}) => id)).toEqual(['page-2']);
    expect(data?.used).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/pages/page-1', expect.objectContaining({method: 'DELETE'}));
  });

  it('never drives the count below zero', async () => {
    const {client, wrapper} = harness();
    client.setQueryData(pageKeys.list(), list([page('page-1')], 0));
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, {status: 204})));

    const {result} = renderHook(() => useDeleteMonitoredPage(), {wrapper});
    await act(async () => {
      await result.current.mutateAsync({pageId: 'page-1'});
    });

    expect(client.getQueryData<LoadPagesResponse>(pageKeys.list())?.used).toBe(0);
  });

  it('keeps the row when removal fails', async () => {
    const {client, wrapper} = harness();
    client.setQueryData(pageKeys.list(), list([page('page-1'), page('page-2')]));
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Server error'})));

    const {result} = renderHook(() => useDeleteMonitoredPage(), {wrapper});
    await act(async () => {
      await result.current.mutateAsync({pageId: 'page-1'}).catch(() => undefined);
    });

    const data = client.getQueryData<LoadPagesResponse>(pageKeys.list());
    expect(data?.pages).toHaveLength(2);
    expect(data?.used).toBe(2);
  });
});
