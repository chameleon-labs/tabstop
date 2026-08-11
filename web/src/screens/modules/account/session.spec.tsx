import {renderHook, waitFor} from '@testing-library/react';
import {QueryClient} from '@tanstack/react-query';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {refreshSession, sessionKeys, useSession} from './session';
import {ApiError} from '@/api/client';
import {jsonResponse} from '@/test/http';
import {wrapper} from '@/test/render';

const account = {id: '7', email: 'george@example.test', alertThreshold: 5};
const freshAccount = {id: '7', email: 'fresh@example.test', alertThreshold: 10};
const refreshQueryClient = (): QueryClient =>
  new QueryClient({defaultOptions: {queries: {retry: false, staleTime: 30_000}}});

describe('useSession', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, account)));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the account when there is a session', async () => {
    const {result} = renderHook(() => useSession(), {wrapper});

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(account);
  });

  it('answers null for a 401, because that is an answer and not a failure', async () => {
    // "Nobody is signed in" is exactly what the caller asked. Leaving it as an
    // error would make the route guards unable to tell it apart from a backend
    // they could not reach.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(401, {error: 'Unauthorized'})));

    const {result} = renderHook(() => useSession(), {wrapper});

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('keeps a 500 an error, so an outage never reads as signed out', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Internal server error'})));

    const {result} = renderHook(() => useSession(), {wrapper});

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.data).toBeUndefined();
  });

  it('keeps a 403 an error too - only 401 means no session', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(403, {error: 'Forbidden'})));

    const {result} = renderHook(() => useSession(), {wrapper});

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });

  it('sends the cookie, which is the only way this question can be answered', async () => {
    renderHook(() => useSession(), {wrapper});

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/me');
    expect(init.credentials).toBe('include');
  });
});

describe('refreshSession', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, freshAccount)));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches a fresh account instead of returning the cached account', async () => {
    const queryClient = refreshQueryClient();
    const oldAccount = {id: '7', email: 'old@example.test', alertThreshold: 1};
    queryClient.setQueryData(sessionKeys.me, oldAccount);

    const refreshed = await refreshSession(queryClient);

    expect(refreshed).toEqual(freshAccount);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when the refresh request receives a 401', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(401, {error: 'Unauthorized'})));
    const queryClient = refreshQueryClient();

    await expect(refreshSession(queryClient)).resolves.toBeNull();
  });

  it('rejects with ApiError when the refresh request receives a 500', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Internal server error'})));
    const queryClient = refreshQueryClient();

    await expect(refreshSession(queryClient)).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects with the original TypeError when the refresh request cannot reach the server', async () => {
    const networkError = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValue(networkError);
    const queryClient = refreshQueryClient();

    await expect(refreshSession(queryClient)).rejects.toBe(networkError);
  });

  it('rejects with an ApiError for a 403 refresh response', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(403, {error: 'Forbidden'})));
    const queryClient = refreshQueryClient();
    const refresh = refreshSession(queryClient);

    await expect(refresh).rejects.toBeInstanceOf(ApiError);
    await expect(refresh).rejects.toMatchObject({status: 403});
  });
});
