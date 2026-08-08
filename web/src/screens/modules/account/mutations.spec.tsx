import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook} from '@testing-library/react';
import type {PropsWithChildren} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useLogin, useLogout, useSignup} from './mutations';
import {sessionKeys} from './session';
import {jsonResponse} from '@/test/http';

const account = {id: '7', email: 'george@example.test', alertThreshold: 5};
const credentials = {email: 'george@example.test', password: 'correct horse battery staple'};

const queryClient = (): QueryClient =>
  new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});

describe('useLogin', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the account confirmed after posting credentials', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, account)).mockResolvedValueOnce(jsonResponse(200, account));
    const client = queryClient();
    const wrapper = ({children}: PropsWithChildren): React.JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const {result} = renderHook(() => useLogin(), {wrapper});

    await expect(result.current.mutateAsync(credentials)).resolves.toEqual(account);

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/login', '/api/me']);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify(credentials),
      credentials: 'include',
    });
  });

  it('rejects when successful credentials do not create a session', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, account))
      .mockResolvedValueOnce(jsonResponse(401, {error: 'Unauthorized'}));
    const client = queryClient();
    const wrapper = ({children}: PropsWithChildren): React.JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const {result} = renderHook(() => useLogin(), {wrapper});

    await expect(result.current.mutateAsync(credentials)).rejects.toThrow('Could not confirm your session');
    expect(client.getQueryData(['session', 'me'])).toBeNull();
  });
});

describe('useSignup', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the account confirmed after posting credentials', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, account)).mockResolvedValueOnce(jsonResponse(200, account));
    const client = queryClient();
    const wrapper = ({children}: PropsWithChildren): React.JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const {result} = renderHook(() => useSignup(), {wrapper});

    await expect(result.current.mutateAsync(credentials)).resolves.toEqual(account);

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/signup', '/api/me']);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify(credentials),
      credentials: 'include',
    });
  });

  it('rejects when successful credentials do not create a session', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, account))
      .mockResolvedValueOnce(jsonResponse(401, {error: 'Unauthorized'}));
    const client = queryClient();
    const wrapper = ({children}: PropsWithChildren): React.JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const {result} = renderHook(() => useSignup(), {wrapper});

    await expect(result.current.mutateAsync(credentials)).rejects.toThrow('Could not confirm your session');
    expect(client.getQueryData(['session', 'me'])).toBeNull();
  });
});

describe('useLogout', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('removes prior query data before confirming the session is signed out', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, {status: 204}))
      .mockResolvedValueOnce(jsonResponse(401, {error: 'Unauthorized'}));
    const client = queryClient();
    client.setQueryData(['pages'], [{id: 'page-1'}]);
    client.setQueryData(sessionKeys.me, account);
    const oldQueries = client.getQueryCache().getAll();
    const wrapper = ({children}: PropsWithChildren): React.JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const {result} = renderHook(() => useLogout(), {wrapper});

    await expect(result.current.mutateAsync()).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/logout', '/api/me']);
    expect(oldQueries).toHaveLength(2);
    for (const oldQuery of oldQueries) {
      expect(client.getQueryCache().getAll()).not.toContain(oldQuery);
    }
    expect(client.getQueryData(['pages'])).toBeUndefined();
    expect(client.getQueryData(sessionKeys.me)).toBeNull();
  });

  it('preserves the cache when the logout request fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {error: 'Could not sign out'}));
    const client = queryClient();
    const pages = [{id: 'page-1'}];
    client.setQueryData(['pages'], pages);
    client.setQueryData(sessionKeys.me, account);
    const wrapper = ({children}: PropsWithChildren): React.JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const {result} = renderHook(() => useLogout(), {wrapper});

    await expect(result.current.mutateAsync()).rejects.toThrow('Could not sign out');

    expect(client.getQueryData(['pages'])).toEqual(pages);
    expect(client.getQueryData(sessionKeys.me)).toEqual(account);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/logout']);
  });

  it('rejects when logout is followed by an authenticated session', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, {status: 204})).mockResolvedValueOnce(jsonResponse(200, account));
    const client = queryClient();
    client.setQueryData(['pages'], [{id: 'page-1'}]);
    client.setQueryData(sessionKeys.me, account);
    const oldQueries = client.getQueryCache().getAll();
    const wrapper = ({children}: PropsWithChildren): React.JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const {result} = renderHook(() => useLogout(), {wrapper});

    await expect(result.current.mutateAsync()).rejects.toThrow('Could not confirm that you signed out');

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/logout', '/api/me']);
    for (const oldQuery of oldQueries) {
      expect(client.getQueryCache().getAll()).not.toContain(oldQuery);
    }
    expect(client.getQueryData(['pages'])).toBeUndefined();
    expect(client.getQueryData(sessionKeys.me)).toEqual(account);
  });
});
