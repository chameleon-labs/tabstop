import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {LogoutButton} from './index';
import {useLogout} from '../../mutations';
import {sessionKeys} from '../../session';
import {jsonResponse} from '@/test/http';

const account = {id: '7', email: 'george@example.test', alertThreshold: 5};
const pages = [{id: 'page-1'}];

const LogoutButtonHarness = (): React.JSX.Element => {
  const logout = useLogout();

  return <LogoutButton logout={logout} />;
};

const renderLogout = (queryClient: QueryClient) => {
  const router = createMemoryRouter(
    [
      {path: '/before', element: <h1>Before dashboard</h1>},
      {path: '/dashboard', element: <LogoutButtonHarness />},
      {path: '/', element: <h1>Home</h1>},
    ],
    {initialEntries: ['/before', '/dashboard'], initialIndex: 1},
  );

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return router;
};

const queryClient = (): QueryClient =>
  new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});

describe('LogoutButton', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('locks while signing out, clears account data, confirms the session, and replaces with home', async () => {
    let finishLogout = (): void => undefined;
    let finishConfirmation = (): void => undefined;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishLogout = () => resolve(new Response(null, {status: 204}));
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishConfirmation = () => resolve(jsonResponse(401, {error: 'Unauthorized'}));
          }),
      );
    const client = queryClient();
    client.setQueryData(['pages'], pages);
    client.setQueryData(sessionKeys.me, account);
    const router = renderLogout(client);

    await userEvent.click(screen.getByRole('button', {name: 'Log out'}));

    expect(screen.getByRole('button', {name: 'Signing out…'})).toBeDisabled();
    expect(client.getQueryData(['pages'])).toEqual(pages);

    act(() => {
      finishLogout();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(router.state.location.pathname).toBe('/dashboard');
    expect(screen.queryByRole('heading', {name: 'Home'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Signing out…'})).toBeDisabled();
    expect(client.getQueryData(['pages'])).toBeUndefined();
    expect(client.getQueryData(sessionKeys.me)).toBeUndefined();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/logout', '/api/me']);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/logout',
      expect.objectContaining({method: 'POST', credentials: 'include'}),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body');

    act(() => {
      finishConfirmation();
    });

    expect(await screen.findByRole('heading', {name: 'Home'})).toBeVisible();
    expect(client.getQueryData(sessionKeys.me)).toBeNull();

    await act(async () => {
      await router.navigate(-1);
    });
    expect(await screen.findByRole('heading', {name: 'Before dashboard'})).toBeVisible();
  });

  it('preserves account data and route when logout fails, then focuses the server error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {error: 'Redis could not revoke this session'}));
    const client = queryClient();
    client.setQueryData(['pages'], pages);
    client.setQueryData(sessionKeys.me, account);
    const router = renderLogout(client);

    await userEvent.click(screen.getByRole('button', {name: 'Log out'}));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Redis could not revoke this session');
    expect(alert).toHaveFocus();
    expect(client.getQueryData(['pages'])).toEqual(pages);
    expect(client.getQueryData(sessionKeys.me)).toEqual(account);
    expect(router.state.location.pathname).toBe('/dashboard');
    await waitFor(() => {
      expect(screen.getByRole('button', {name: 'Log out'})).toBeEnabled();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stays in place and focuses the confirmation error after a successful logout request', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, {status: 204}))
      .mockResolvedValueOnce(jsonResponse(500, {error: 'Session confirmation failed'}));
    const client = queryClient();
    client.setQueryData(['pages'], pages);
    client.setQueryData(sessionKeys.me, account);
    const router = renderLogout(client);

    await userEvent.click(screen.getByRole('button', {name: 'Log out'}));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Session confirmation failed');
    expect(alert).toHaveFocus();
    expect(router.state.location.pathname).toBe('/dashboard');
    expect(client.getQueryData(['pages'])).toBeUndefined();
    expect(client.getQueryData(sessionKeys.me)).toBeUndefined();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/logout', '/api/me']);
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body');
    expect(screen.queryByRole('button', {name: 'Log out'})).not.toBeInTheDocument();
  });
});
