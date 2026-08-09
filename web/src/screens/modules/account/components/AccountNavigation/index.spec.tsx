import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen} from '@testing-library/react';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AccountNavigation} from './index';
import {jsonResponse} from '@/test/http';

const account = {id: '7', email: 'george@example.test', alertThreshold: 5};

const renderNavigation = (): void => {
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
    <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
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

  it('lets a real session failure reach the route boundary', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {error: 'Session lookup failed'}));
    renderNavigation();

    expect(await screen.findByRole('heading', {name: 'Session unavailable'})).toBeVisible();
  });
});
