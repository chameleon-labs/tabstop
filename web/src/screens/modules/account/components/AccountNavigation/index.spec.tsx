import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AccountNavigation} from './index';
import {sessionKeys} from '../../session';
import {jsonResponse} from '@/test/http';

const account = {id: '7', email: 'george@example.test', alertThreshold: 5};
const pages = [{id: 'page-1'}];

const makeQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {queries: {retry: false, staleTime: 30_000}, mutations: {retry: false}},
  });

const renderNavigation = (queryClient = makeQueryClient()) => {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: <AccountNavigation />,
        errorElement: <h1>Session unavailable</h1>,
      },
    ],
    {initialEntries: ['/somewhere']},
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return {queryClient, router};
};

describe('AccountNavigation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse(401, {error: 'Unauthorized'})));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers login and signup only when no account is signed in', async () => {
    renderNavigation();

    expect(await screen.findByRole('link', {name: 'Log in'})).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', {name: 'Sign up'})).toHaveAttribute('href', '/signup');
    expect(screen.queryByRole('link', {name: 'Dashboard'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Log out'})).not.toBeInTheDocument();
  });

  it('offers dashboard and logout only when an account is signed in', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, account));
    renderNavigation();

    expect(await screen.findByRole('link', {name: 'Dashboard'})).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('button', {name: 'Log out'})).toBeVisible();
    expect(screen.queryByRole('link', {name: 'Log in'})).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Sign up'})).not.toBeInTheDocument();
  });

  it('keeps an empty named navigation while the session is pending', () => {
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>(() => {
          // This response stays pending so stale account controls would be observable.
        }),
    );
    renderNavigation();

    const navigation = screen.getByRole('navigation', {name: 'Main'});
    expect(navigation).toBeEmptyDOMElement();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps the named navigation empty when the shell session lookup fails', async () => {
    let failSession = (): void => undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          failSession = () => resolve(jsonResponse(500, {error: 'Session lookup failed'}));
        }),
    );
    const {queryClient} = renderNavigation();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      failSession();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(queryClient.getQueryState(sessionKeys.me)?.status).toBe('error');
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('navigation', {name: 'Main'})).toBeEmptyDOMElement();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', {name: 'Session unavailable'})).not.toBeInTheDocument();
    });
  });

  it('hides every account state when revocation succeeds but anonymous confirmation fails', async () => {
    let finishLogout = (): void => undefined;
    let failConfirmation = (): void => undefined;
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
            failConfirmation = () => resolve(jsonResponse(500, {error: 'Session confirmation failed'}));
          }),
      );
    const queryClient = makeQueryClient();
    queryClient.setQueryData(sessionKeys.me, account);
    queryClient.setQueryData(['pages'], pages);
    const {router} = renderNavigation(queryClient);
    await screen.findByRole('link', {name: 'Dashboard'});

    await userEvent.click(screen.getByRole('button', {name: 'Log out'}));

    act(() => {
      finishLogout();
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole('button', {name: 'Signing out…'})).toBeDisabled();
    expect(screen.queryByRole('link', {name: 'Dashboard'})).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Log in'})).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Sign up'})).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/somewhere');

    act(() => {
      failConfirmation();
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Session confirmation failed');
    expect(alert).toHaveFocus();
    expect(queryClient.getQueryData(['pages'])).toBeUndefined();
    expect(router.state.location.pathname).toBe('/somewhere');
    expect(screen.queryByRole('link', {name: 'Dashboard'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Log out'})).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Log in'})).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Sign up'})).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/logout', '/api/me']);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/logout',
      expect.objectContaining({method: 'POST', credentials: 'include'}),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body');
  });

  it('hides stale controls when revocation is contradicted by an authenticated confirmation', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, {status: 204}))
      .mockResolvedValueOnce(jsonResponse(200, account));
    const queryClient = makeQueryClient();
    queryClient.setQueryData(sessionKeys.me, account);
    queryClient.setQueryData(['pages'], pages);
    const {router} = renderNavigation(queryClient);
    await screen.findByRole('link', {name: 'Dashboard'});

    await userEvent.click(screen.getByRole('button', {name: 'Log out'}));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveFocus();
    expect(queryClient.getQueryData(['pages'])).toBeUndefined();
    expect(router.state.location.pathname).toBe('/somewhere');
    expect(screen.queryByRole('link', {name: 'Dashboard'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Log out'})).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Log in'})).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Sign up'})).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/logout', '/api/me']);
  });

  it('keeps authenticated controls retryable when the logout request itself fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {error: 'Could not revoke this session'}));
    const queryClient = makeQueryClient();
    queryClient.setQueryData(sessionKeys.me, account);
    queryClient.setQueryData(['pages'], pages);
    const {router} = renderNavigation(queryClient);
    await screen.findByRole('link', {name: 'Dashboard'});

    await userEvent.click(screen.getByRole('button', {name: 'Log out'}));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not revoke this session');
    expect(alert).toHaveFocus();
    expect(queryClient.getQueryData(['pages'])).toEqual(pages);
    expect(queryClient.getQueryData(sessionKeys.me)).toEqual(account);
    expect(router.state.location.pathname).toBe('/somewhere');
    expect(screen.getByRole('link', {name: 'Dashboard'})).toBeVisible();
    expect(screen.getByRole('button', {name: 'Log out'})).toBeEnabled();
    expect(screen.queryByRole('link', {name: 'Log in'})).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Sign up'})).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/logout']);
  });
});
