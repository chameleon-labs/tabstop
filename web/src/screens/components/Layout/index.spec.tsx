import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Layout, providesSessionFree} from './index';
import {RouteError} from '../RouteError';
import {sessionKeys} from '@/screens/modules/account/session';
import {jsonResponse} from '@/test/http';

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

/** A screen that brings its own `<main>` and footer - as the landing page does. */
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
              // No header of its own: that is shared now, and supplying a
              // second one is the two-banner bug this flag used to prevent.
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
    // jsdom computes no layout, so this ties the MARKUP to the stylesheet -
    // which is the half that can rot. `site-header.css.spec.ts` asserts the
    // rules exist; without this, dropping the class here leaves the landing
    // footer floating on a short page and every test still green.
    renderLayout();

    expect(document.querySelector('.app-shell')).not.toBeNull();
    expect(screen.getByRole('main')).toHaveClass('app-shell__main');
  });

  describe('when a screen brings its own main', () => {
    it('steps back, leaving exactly one of each landmark', async () => {
      // The shell's `<main>` wrapping the screen's own made a `<main>` inside a
      // `<main>` - invalid, and it gives the skip link two `#main` candidates.
      // The header is no longer part of this: it is shared, and the screen
      // supplying one was the two-banner half of the bug.
      renderOwnMain();
      await screen.findByRole('heading', {level: 1, name: 'A screen'});

      expect(screen.getAllByRole('banner')).toHaveLength(1);
      expect(screen.getAllByRole('main')).toHaveLength(1);
      expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
      expect(document.querySelectorAll('#main')).toHaveLength(1);
    });

    it('still has a #main for the skip link when the screen throws', async () => {
      // The route still matches and its handle still says `ownMain`, so the
      // shell steps back exactly as it would for a working screen - but what
      // renders is the error boundary, which is not the screen. Left alone that
      // produces an error page with no landmarks and a retained skip link
      // pointing at a `#main` that does not exist.
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
      // The screen supplies the landmarks; it does not supply the escape from
      // them. Dropping this with the header would take the skip link off the
      // one screen with the most chrome to skip.
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
      // The entire point. If anything in the header comes first, a keyboard
      // user tabs through the whole navigation on every page to reach content,
      // and the link may as well not exist.
      renderLayout();

      await userEvent.tab();

      expect(screen.getByRole('link', {name: 'Skip to content'})).toHaveFocus();
    });

    it('points at a target that exists', () => {
      // A skip link to a missing id is worse than none: it looks like an
      // affordance and silently does nothing.
      renderLayout();

      const link = screen.getByRole('link', {name: 'Skip to content'});
      const href = link.getAttribute('href') ?? '';

      expect(href).toBe('#main');
      expect(document.querySelector(href)).toBe(screen.getByRole('main'));
    });

    it('targets an element that can actually take focus', () => {
      // Without `tabIndex={-1}` the browser scrolls to `#main` but leaves focus
      // where it was, so the next Tab starts from the top of the page again -
      // the link appears to work and does not.
      renderLayout();

      expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
    });
  });

  it('gives the navigation an accessible name', () => {
    // A landmark with no name is one of several identical "navigation" entries
    // in a screen reader's landmark list.
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
    // Log out moved inside the account menu; the header's signed-in control is
    // the avatar that opens it.
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
    // It has to persist ACROSS navigations. Mounted per screen, the region
    // would be new each time and a new region's content is initial content -
    // announced by nothing.
    renderLayout();

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('offers a way home from every page', () => {
    renderLayout();

    expect(screen.getByRole('link', {name: 'tabstop'})).toHaveAttribute('href', '/');
  });
});
