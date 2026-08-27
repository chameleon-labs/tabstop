import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {PageHistoryPoint, PageHistoryResponse} from '@tabstop/contract';
import {jsonResponse} from '@/test/http';
import {
  DEFAULT_HISTORY_WINDOW,
  IN_FLIGHT_HISTORY_POLL_MS,
  historyWindowFrom,
  pageHistoryKeys,
  usePageHistory,
  type HistoryWindow,
} from './page-history';

const point = (overrides: Partial<PageHistoryPoint> = {}): PageHistoryPoint => ({
  auditId: 'audit-1',
  createdAt: '2026-08-15T10:00:00.000Z',
  status: 'done',
  score: 74,
  countsByImpact: {minor: 1, moderate: 2, serious: 0, critical: 1},
  axeVersion: '4.12.1',
  ...(overrides.status === 'queued' || overrides.status === 'running' ? {score: null, axeVersion: null} : {}),
  ...overrides,
});

const history = (overrides: Partial<PageHistoryResponse> = {}): PageHistoryResponse => ({
  pageId: 'page-1',
  url: 'https://example.test/pricing',
  days: 90,
  points: [point()],
  ...overrides,
});

const harness = (): {client: QueryClient; wrapper: React.FC<{children: React.ReactNode}>} => {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});

  return {
    client,
    wrapper: ({children}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  };
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({shouldAdvanceTime: true});
  fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, history())));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('usePageHistory', () => {
  it('asks for the window it was given, with the session cookie', async () => {
    const {wrapper} = harness();
    renderHook(() => usePageHistory('page-1', 90), {wrapper});

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/pages/page-1/history?days=90',
        expect.objectContaining({credentials: 'include'}),
      );
    });
  });

  it('encodes the page id, so an id cannot forge a path', async () => {
    const {wrapper} = harness();
    renderHook(() => usePageHistory('../audits/secret', 90), {wrapper});

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/pages/..%2Faudits%2Fsecret/history?days=90', expect.anything());
    });
  });

  it('caches each window separately rather than reusing the last answer', async () => {
    const {client, wrapper} = harness();
    const {rerender} = renderHook(({days}: {days: HistoryWindow}) => usePageHistory('page-1', days), {
      wrapper,
      initialProps: {days: DEFAULT_HISTORY_WINDOW},
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    rerender({days: 30});

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/pages/page-1/history?days=30', expect.anything());
    });
    expect(client.getQueryData(pageHistoryKeys.detail('page-1', 90))).toBeDefined();
    expect(client.getQueryData(pageHistoryKeys.detail('page-1', 30))).toBeDefined();
  });

  it('asks for nothing while the page id is still unknown', async () => {
    const {wrapper} = harness();
    const {result} = renderHook(() => usePageHistory(undefined, 90), {wrapper});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('leaves a settled window alone, however long the page stays open', async () => {
    const {wrapper} = harness();
    renderHook(() => usePageHistory('page-1', 90), {wrapper});

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['queued', 'running'] as const)('follows a %s point until it settles', async (status) => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, history({points: [point({status})]}))));
    const {wrapper} = harness();
    renderHook(() => usePageHistory('page-1', 90), {wrapper});

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IN_FLIGHT_HISTORY_POLL_MS);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('stops the moment that point reaches a terminal status', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, history({points: [point({status: 'running'})]}))),
    );
    const {wrapper} = harness();
    renderHook(() => usePageHistory('page-1', 90), {wrapper});

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, history())));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(IN_FLIGHT_HISTORY_POLL_MS * 2);
    });
    const afterSettling = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IN_FLIGHT_HISTORY_POLL_MS * 5);
    });

    expect(fetchMock).toHaveBeenCalledTimes(afterSettling);
  });

  it('asks past the browser cache once it knows a point is unfinished', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, history({points: [point({status: 'running'})]}))),
    );
    const {wrapper} = harness();
    renderHook(() => usePageHistory('page-1', 90), {wrapper});

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock.mock.calls[0]?.[1]).not.toMatchObject({cache: 'no-store'});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IN_FLIGHT_HISTORY_POLL_MS);
    });

    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({cache: 'no-store'});
  });

  it('stops polling when a window it already has starts failing', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, history({points: [point({status: 'running'})]}))),
    );
    const {client, wrapper} = harness();
    const {result} = renderHook(() => usePageHistory('page-1', 90), {wrapper});

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Server error'})));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(IN_FLIGHT_HISTORY_POLL_MS);
    });

    await waitFor(() => {
      expect(client.getQueryCache().find({queryKey: pageHistoryKeys.detail('page-1', 90)})?.state.status).toBe('error');
    });
    const afterFailure = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IN_FLIGHT_HISTORY_POLL_MS * 5);
    });

    expect(fetchMock).toHaveBeenCalledTimes(afterFailure);
  });
});

describe('historyWindowFrom', () => {
  it.each([
    ['30', 30],
    ['90', 90],
    ['365', 365],
  ])('reads %s as the window it names', (value, expected) => {
    expect(historyWindowFrom(value)).toBe(expected);
  });

  it.each([null, '', '0', '-30', '45', 'abc', '1000', '90.5'])('falls back to the default for %s', (value) => {
    expect(historyWindowFrom(value)).toBe(DEFAULT_HISTORY_WINDOW);
  });

  it('defaults to the window the server itself defaults to', () => {
    expect(DEFAULT_HISTORY_WINDOW).toBe(90);
  });
});
