import {renderHook, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useSession} from './session';
import {jsonResponse} from '@/test/http';
import {wrapper} from '@/test/render';

const account = {id: '7', email: 'george@example.test', alertThreshold: 5};

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
    // error would make `RequireAuth` unable to tell it apart from a backend it
    // could not reach.
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
