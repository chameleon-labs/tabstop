import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen} from '@testing-library/react';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {RequireAnonymous} from './index';
import {jsonResponse} from '@/test/http';

const account = {id: '1', email: 'a@b.co', alertThreshold: 5};

const renderGate = (): ReturnType<typeof createMemoryRouter> => {
  const router = createMemoryRouter(
    [
      {path: '/start', element: <h1>Where they came from</h1>},
      {
        path: '/login',
        element: (
          <RequireAnonymous>
            <h1>Sign in</h1>
          </RequireAnonymous>
        ),
      },
      {path: '/dashboard', element: <h1>Dashboard</h1>},
    ],
    {initialEntries: ['/start', '/login'], initialIndex: 1},
  );

  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {queries: {retry: false}},
        })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return router;
};

describe('RequireAnonymous', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse(401, {error: 'Unauthorized'})));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows nothing while the session answer is pending', async () => {
    let release = (): void => undefined;
    fetchMock.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return jsonResponse(401, {error: 'Unauthorized'});
    });

    renderGate();

    expect(document.body).toHaveTextContent('');
    release();
    expect(await screen.findByRole('heading', {name: 'Sign in'})).toBeVisible();
  });

  it('renders its children for a signed-out session', async () => {
    renderGate();

    expect(await screen.findByRole('heading', {name: 'Sign in'})).toBeVisible();
  });

  it('replaces the login entry when a session already exists', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, account)));

    const router = renderGate();

    expect(await screen.findByRole('heading', {name: 'Dashboard'})).toBeVisible();

    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByRole('heading', {name: 'Where they came from'})).toBeVisible();
    expect(router.state.location.pathname).toBe('/start');
  });

  it('rethrows a real session failure to the route boundary', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Internal server error'})));

    const router = createMemoryRouter(
      [
        {
          path: '/login',
          element: (
            <RequireAnonymous>
              <h1>Sign in</h1>
            </RequireAnonymous>
          ),
          errorElement: <h1>Boundary caught it</h1>,
        },
      ],
      {initialEntries: ['/login']},
    );

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {queries: {retry: false}},
          })
        }
      >
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', {name: 'Boundary caught it'})).toBeVisible();
  });
});
