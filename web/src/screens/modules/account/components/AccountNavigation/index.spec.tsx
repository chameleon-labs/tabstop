import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor} from '@testing-library/react';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AccountNavigation} from './index';
import {sessionKeys} from '../../session';
import {jsonResponse} from '@/test/http';

const account = {id: '7', email: 'george@example.test', alertThreshold: 5};

const renderNavigation = (): QueryClient => {
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
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return queryClient;
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
    const queryClient = renderNavigation();

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
});
