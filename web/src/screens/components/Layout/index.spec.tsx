import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Layout, providesSessionFree} from './index';
import {RouteError} from '../RouteError';
import {sessionKeys} from '@/screens/modules/account/session';
import {jsonResponse} from '@/test/http';
import {advanceTimers, heldChunk, type HeldChunk} from '@/test/lazy-route';
import {ROUTE_BUSY_DELAY_MS} from '@/screens/hooks/use-route-busy';

const renderLayout = (): QueryClient => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Layout />,
        children: [{index: true, element: <h1>A screen</h1>}],
      },
    ],
    {initialEntries: ['/']},
  );
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return queryClient;
};

const renderOwnMain = (): void => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Layout />,
        children: [
          {
            index: true,
            handle: {ownMain: true},
            element: (
              <div>
                <main id="main" tabIndex={-1}>
                  <h1>A screen</h1>
                </main>
                <footer>a footer</footer>
              </div>
            ),
          },
        ],
      },
    ],
    {initialEntries: ['/']},
  );

  render(
    <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

describe('Layout', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse(401, {error: 'Unauthorized'})));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('session-free route metadata', () => {
    it('accepts only an object whose sessionFree flag is exactly true', () => {
      expect(providesSessionFree({sessionFree: true})).toBe(true);
      expect(providesSessionFree({sessionFree: false})).toBe(false);
      expect(providesSessionFree({sessionFree: 'true'})).toBe(false);
      expect(providesSessionFree(null)).toBe(false);
      expect(providesSessionFree(['sessionFree'])).toBe(false);
    });
  });

  it('carries the shell classes the sticky-footer column is written against', () => {
    renderLayout();

    expect(document.querySelector('.app-shell')).not.toBeNull();
    expect(screen.getByRole('main')).toHaveClass('app-shell__main');
  });

  describe('when a screen brings its own main', () => {
    it('steps back, leaving exactly one of each landmark', async () => {
      renderOwnMain();
      await screen.findByRole('heading', {level: 1, name: 'A screen'});

      expect(screen.getAllByRole('banner')).toHaveLength(1);
      expect(screen.getAllByRole('main')).toHaveLength(1);
      expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
      expect(document.querySelectorAll('#main')).toHaveLength(1);
    });

    it('still has a #main for the skip link when the screen throws', async () => {
      const Boom = (): React.JSX.Element => {
        throw new Error('boom');
      };
      const router = createMemoryRouter(
        [
          {
            path: '/',
            element: <Layout />,
            children: [
              {
                errorElement: <RouteError />,
                children: [{index: true, element: <Boom />, handle: {ownMain: true}}],
              },
            ],
          },
        ],
        {initialEntries: ['/']},
      );
      render(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );
      await screen.findByRole('heading', {level: 1, name: 'Something went wrong'});

      expect(screen.getAllByRole('main')).toHaveLength(1);
      expect(document.querySelectorAll('#main')).toHaveLength(1);
      expect(screen.getByRole('link', {name: 'Skip to content'})).toHaveAttribute('href', '#main');
    });

    it("keeps the skip link, which stays the shell's job either way", async () => {
      renderOwnMain();
      await screen.findByRole('heading', {level: 1, name: 'A screen'});

      expect(screen.getByRole('link', {name: 'Skip to content'})).toHaveAttribute('href', '#main');
    });
  });

  it('renders the matched screen into the shell', async () => {
    renderLayout();

    expect(await screen.findByRole('heading', {level: 1, name: 'A screen'})).toBeVisible();
  });

  describe('the skip link', () => {
    it('is the first thing a keyboard reaches', async () => {
      renderLayout();

      await userEvent.tab();

      expect(screen.getByRole('link', {name: 'Skip to content'})).toHaveFocus();
    });

    it('points at a target that exists', () => {
      renderLayout();

      const link = screen.getByRole('link', {name: 'Skip to content'});
      const href = link.getAttribute('href') ?? '';

      expect(href).toBe('#main');
      expect(document.querySelector(href)).toBe(screen.getByRole('main'));
    });

    it('targets an element that can actually take focus', () => {
      renderLayout();

      expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
    });
  });

  it('gives the navigation an accessible name', () => {
    renderLayout();

    expect(screen.getByRole('navigation', {name: 'Main'})).toBeVisible();
  });

  it('renders anonymous account entry points in the shell navigation', async () => {
    renderLayout();

    expect(await screen.findByRole('link', {name: 'Log in'})).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', {name: 'Sign up'})).toHaveAttribute('href', '/signup');
  });

  it('renders authenticated account controls in the shell navigation', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {id: '7', email: 'george@example.test', alertThreshold: 5}));
    renderLayout();

    expect(await screen.findByRole('link', {name: 'Dashboard'})).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('button', {name: /Account menu/})).toBeVisible();
    expect(screen.queryByRole('link', {name: 'Log in'})).not.toBeInTheDocument();
  });

  it('keeps the shell and screen while a shell session lookup is failing', async () => {
    let failSession = (): void => undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          failSession = () => resolve(jsonResponse(500, {error: 'Session lookup failed'}));
        }),
    );
    const queryClient = renderLayout();

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
      expect(screen.getByRole('heading', {level: 1, name: 'A screen'})).toBeVisible();
      expect(screen.getByRole('link', {name: 'Skip to content'})).toBeInTheDocument();
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByRole('navigation', {name: 'Main'})).toBeEmptyDOMElement();
      expect(screen.queryByRole('link', {name: 'Dashboard'})).not.toBeInTheDocument();
      expect(screen.queryByRole('button', {name: /Account menu/})).not.toBeInTheDocument();
    });
  });

  it('keeps revocation authoritative across landing-page navigation', async () => {
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
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <Layout />,
          children: [
            {
              index: true,
              handle: {ownMain: true},
              element: (
                <main id="main" tabIndex={-1}>
                  <h1>Public landing</h1>
                </main>
              ),
            },
            {path: 'dashboard', element: <h1>Private dashboard</h1>},
          ],
        },
      ],
      {initialEntries: ['/dashboard']},
    );
    const queryClient = new QueryClient({
      defaultOptions: {queries: {retry: false, staleTime: 30_000}, mutations: {retry: false}},
    });
    queryClient.setQueryData(sessionKeys.me, {id: '7', email: 'george@example.test', alertThreshold: 5});
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole('button', {name: /Account menu/}));
    await userEvent.click(await screen.findByRole('menuitem', {name: 'Log out'}));
    await act(async () => {
      await router.navigate('/');
    });
    expect(screen.getByRole('heading', {name: 'Public landing'})).toBeVisible();

    act(() => {
      finishLogout();
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await router.navigate('/dashboard');
    });

    expect(screen.queryByRole('heading', {name: 'Private dashboard'})).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Dashboard'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /Account menu/})).not.toBeInTheDocument();

    act(() => {
      failConfirmation();
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Session confirmation failed');
    expect(alert).toHaveFocus();
    expect(screen.queryByRole('heading', {name: 'Private dashboard'})).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Log in'})).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Sign up'})).not.toBeInTheDocument();
  });

  it('renders public shell routes after signed-out confirmation succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, {status: 204}))
      .mockResolvedValueOnce(jsonResponse(401, {error: 'Unauthorized'}));
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <Layout />,
          children: [
            {
              index: true,
              handle: {ownMain: true},
              element: (
                <main id="main" tabIndex={-1}>
                  <h1>Public landing</h1>
                </main>
              ),
            },
            {path: 'dashboard', element: <h1>Private dashboard</h1>},
            {path: 'login', element: <h1>Sign in screen</h1>},
          ],
        },
      ],
      {initialEntries: ['/dashboard']},
    );
    const queryClient = new QueryClient({
      defaultOptions: {queries: {retry: false, staleTime: 30_000}, mutations: {retry: false}},
    });
    queryClient.setQueryData(sessionKeys.me, {id: '7', email: 'george@example.test', alertThreshold: 5});
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole('button', {name: /Account menu/}));
    await userEvent.click(await screen.findByRole('menuitem', {name: 'Log out'}));
    expect(await screen.findByRole('heading', {name: 'Public landing'})).toBeVisible();
    await act(async () => {
      await router.navigate('/login');
    });

    expect(screen.getByRole('heading', {name: 'Sign in screen'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Log in'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Sign up'})).toBeVisible();
  });

  it('carries the route announcer, since only the shell renders once', () => {
    renderLayout();

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('offers a way home from every page', () => {
    renderLayout();

    expect(screen.getByRole('link', {name: 'tabstop'})).toHaveAttribute('href', '/');
  });
  describe('while a screen is still on its way', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const renderOverSlowRoute = (chunk: HeldChunk): {leave: () => Promise<void>} => {
      const router = createMemoryRouter(
        [
          {
            path: '/',
            element: <Layout />,
            children: [
              {index: true, element: <h1>A screen</h1>},
              {path: 'slow', lazy: chunk.lazy},
            ],
          },
        ],
        {initialEntries: ['/']},
      );
      const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});

      render(
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );

      return {
        leave: async (): Promise<void> => {
          await act(async () => {
            void router.navigate('/slow');
            await Promise.resolve();
          });
        },
      };
    };

    it('reports the wait on the region the screen will land in', async () => {
      const {leave} = renderOverSlowRoute(heldChunk());

      await leave();
      await advanceTimers(ROUTE_BUSY_DELAY_MS);

      expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
      expect(document.querySelector('.route-progress')).toBeInTheDocument();
    });

    it('says nothing about a wait too short to be worth reporting', async () => {
      const {leave} = renderOverSlowRoute(heldChunk());

      await leave();
      await advanceTimers(ROUTE_BUSY_DELAY_MS - 1);

      expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy');
      expect(document.querySelector('.route-progress')).not.toBeInTheDocument();
    });

    it('stops reporting once the screen is there', async () => {
      const chunk = heldChunk(<h1>The slow screen</h1>);
      const {leave} = renderOverSlowRoute(chunk);

      await leave();
      await advanceTimers(ROUTE_BUSY_DELAY_MS);
      await chunk.arrive();
      await advanceTimers(1);

      expect(screen.getByRole('heading', {name: 'The slow screen'})).toBeVisible();
      expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy');
      expect(document.querySelector('.route-progress')).not.toBeInTheDocument();
    });
  });

  describe('when there is no screen to render yet', () => {
    it('puts the given stand-in where the screen would go', () => {
      const router = createMemoryRouter(
        [
          {
            path: '/',
            element: (
              <Layout>
                <p>a stand-in</p>
              </Layout>
            ),
            children: [{index: true, element: <h1>A screen</h1>}],
          },
        ],
        {initialEntries: ['/']},
      );
      const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});

      render(
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );

      expect(within(screen.getByRole('main')).getByText('a stand-in')).toBeInTheDocument();
      expect(screen.queryByRole('heading', {name: 'A screen'})).not.toBeInTheDocument();
      expect(screen.getByRole('link', {name: 'Skip to content'})).toBeInTheDocument();
    });
  });
});
