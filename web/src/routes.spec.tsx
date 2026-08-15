import type {AuditResultResponse, LoadPagesResponse} from '@tabstop/contract';
import {QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor} from '@testing-library/react';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {jsonResponse} from './test/http';
import {makeQueryClient} from './api/query-client';
import {renderAt} from './test/render';
import {makeRoutes} from './routes';
import {destinationFrom, returnToSearch} from './screens/modules/account/return-to';
import {sessionKeys} from './screens/modules/account/session';

const signedIn = {id: '1', email: 'a@b.co', alertThreshold: 5};
const emptyPages: LoadPagesResponse = {pages: [], used: 0, limit: 10};
const completedAudit: AuditResultResponse = {
  auditId: 'abc-123',
  url: 'https://example.com/',
  status: 'done',
  createdAt: '2026-08-14T12:00:00.000Z',
  completedAt: '2026-08-14T12:00:30.000Z',
  score: 100,
  countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
  axeVersion: '4.12.1',
  settled: true,
  error: null,
  violations: [],
};

describe('the route table', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((path) =>
      Promise.resolve(
        path === '/api/audits/abc-123' ? jsonResponse(200, completedAudit) : jsonResponse(401, {error: 'Unauthorized'}),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Answers by path. Returning the account for every unknown path would let a
   * malformed dashboard fixture pass as a page list, which is exactly the sort
   * of thing these tests exist to catch.
   */
  const withSession = (): void => {
    fetchMock.mockImplementation((path) => {
      if (path === '/api/me') {
        return Promise.resolve(jsonResponse(200, signedIn));
      }
      if (path === '/api/pages') {
        return Promise.resolve(jsonResponse(200, emptyPages));
      }
      if (path === '/api/audits/abc-123') {
        return Promise.resolve(jsonResponse(200, completedAudit));
      }

      return Promise.resolve(jsonResponse(404, {error: 'Not found'}));
    });
  };

  it('resolves / to the home screen', async () => {
    renderAt('/');

    expect(await screen.findByRole('heading', {level: 1})).toHaveTextContent('Accessibility monitoring');
  });

  it('costs the landing page nothing, however the visitor arrives', async () => {
    // The constraint the header's design turns on: a marketing visit must not
    // spend an API call. One `enabled` flag away from being lost, and nothing
    // on screen would look wrong if it were.
    renderAt('/');
    await screen.findByRole('heading', {level: 1});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('link', {name: 'Log in'})).toBeVisible();
  });

  it('shows the account header on / when the session is already known', async () => {
    // Still no request. `sessionFree` READS the cache and never fills it, so a
    // visitor who reached `/` from inside the app - where the route guards have
    // already answered - gets their own header rather than an invitation to
    // sign in again.
    withSession();
    const queryClient = makeQueryClient();
    const router = createMemoryRouter(makeRoutes(queryClient), {initialEntries: ['/dashboard']});
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByRole('heading', {level: 1, name: 'Your pages'});
    const beforeLanding = fetchMock.mock.calls.length;

    await act(async () => {
      await router.navigate('/');
    });

    expect(await screen.findByRole('button', {name: /Account menu/})).toBeVisible();
    expect(screen.queryByRole('link', {name: 'Log in'})).not.toBeInTheDocument();
    expect(fetchMock.mock.calls).toHaveLength(beforeLanding);
  });

  it('resolves /dashboard for a signed-in visitor', async () => {
    withSession();

    renderAt('/dashboard');

    expect(await screen.findByRole('heading', {level: 1, name: 'Your pages'})).toBeVisible();
  });

  it('resolves /pages/:id for a signed-in visitor, and passes the id through', async () => {
    withSession();

    renderAt('/pages/42');

    expect(await screen.findByRole('heading', {level: 1, name: 'Page 42'})).toBeVisible();
  });

  it('resolves /r/:uuid without a session, because the uuid is the credential', async () => {
    // The assertion that matters is the second one. Rendering the screen while
    // signed out is only half of it: gating this route would defeat the point
    // of a link you can send to a colleague, and asking the server who you are
    // in order to show it would be the first step toward gating it.
    renderAt('/r/abc-123');

    expect(await screen.findByRole('heading', {level: 1, name: 'example.com'})).toBeVisible();
    // The audit it was asked for, and nothing else. The screen has a request of
    // its own now, so "never called" would no longer say anything about identity.
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/audits/abc-123']);
  });

  it('resolves the score formula without asking for a session', async () => {
    renderAt('/docs/score-formula');

    expect(await screen.findByRole('heading', {level: 1, name: 'How the score is calculated'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Skip to content'})).toHaveAttribute('href', '#main');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disables session fetching only while moving through a public share route', async () => {
    withSession();
    const queryClient = makeQueryClient();
    const router = createMemoryRouter(makeRoutes(queryClient), {initialEntries: ['/dashboard']});
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    // Counted rather than listed: the share screen fetches its own audit, and
    // the question here is only ever how often identity is asked for.
    const sessionCalls = (): string[] =>
      fetchMock.mock.calls.map(([path]) => path).filter((path) => path === '/api/me');

    expect(await screen.findByRole('heading', {level: 1, name: 'Your pages'})).toBeVisible();
    expect(sessionCalls()).toHaveLength(1);

    await act(async () => {
      await router.navigate('/r/abc-123');
    });
    expect(await screen.findByRole('heading', {level: 1, name: 'example.com'})).toBeVisible();
    await act(async () => {
      await queryClient.invalidateQueries({queryKey: sessionKeys.me, exact: true});
    });
    expect(sessionCalls()).toHaveLength(1);

    await act(async () => {
      await router.navigate('/dashboard');
    });
    expect(await screen.findByRole('heading', {level: 1, name: 'Your pages'})).toBeVisible();
    await waitFor(() => {
      expect(sessionCalls()).toHaveLength(2);
    });
  });

  it('resolves /login for a signed-out visitor', async () => {
    renderAt('/login');

    expect(await screen.findByRole('heading', {level: 1, name: 'Log in'})).toBeVisible();
  });

  it('redirects a signed-in visitor away from /login', async () => {
    withSession();

    renderAt('/login');

    expect(await screen.findByRole('heading', {level: 1, name: 'Your pages'})).toBeVisible();
    expect(screen.queryByRole('heading', {level: 1, name: 'Log in'})).not.toBeInTheDocument();
  });

  it('resolves /signup for a signed-out visitor', async () => {
    renderAt('/signup');

    expect(await screen.findByRole('heading', {level: 1, name: 'Create an account'})).toBeVisible();
    expect(screen.getByRole('button', {name: 'Create account'})).toBeVisible();
  });

  it('redirects a signed-in visitor away from /signup', async () => {
    withSession();

    renderAt('/signup');

    expect(await screen.findByRole('heading', {level: 1, name: 'Your pages'})).toBeVisible();
    expect(screen.queryByRole('heading', {level: 1, name: 'Create an account'})).not.toBeInTheDocument();
  });

  it('sends a signed-out visitor away from a guarded route', async () => {
    renderAt('/dashboard');

    // Landed on login, not on the dashboard behind a spinner.
    expect(await screen.findByRole('heading', {level: 1, name: 'Log in'})).toBeVisible();
    expect(screen.queryByRole('heading', {name: 'Your pages'})).not.toBeInTheDocument();
  });

  it('records the complete destination, so login can send them back', async () => {
    // A loader cannot attach history state to a redirect, so the destination
    // travels in the query string. Without it, a deep link into a guarded page
    // becomes the dashboard the moment the visitor signs in.
    const {router} = renderAt('/pages/42?days=30#history');

    await screen.findByRole('heading', {level: 1, name: 'Log in'});

    expect(router.state.location.pathname).toBe('/login');
    expect(destinationFrom(router.state.location.search)).toBe('/pages/42?days=30#history');
  });

  it('replaces the guarded entry rather than pushing over it', async () => {
    // Without `replace`, Back from login returns to the guarded route, which
    // redirects to login again: the visitor is trapped and Back looks broken.
    //
    // Two entries deep, sitting on the second, because that is the only shape
    // that can tell the two apart. From a single entry there is nowhere to go
    // back TO, so the assertion holds however the redirect was made - which is
    // how the vacuous first version of this test was caught.
    const queryClient = makeQueryClient();
    const router = createMemoryRouter(makeRoutes(queryClient), {
      initialEntries: ['/', '/dashboard'],
      initialIndex: 1,
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByRole('heading', {level: 1, name: 'Log in'});

    await act(async () => {
      await router.navigate(-1);
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(screen.queryByRole('heading', {name: 'Log in'})).not.toBeInTheDocument();
  });

  it('sends a signed-in visitor to the destination they were reaching for', async () => {
    withSession();

    const {router} = renderAt(`/login${returnToSearch('/pages/42?days=30#history')}`);

    expect(await screen.findByRole('heading', {level: 1, name: 'Page 42'})).toBeVisible();
    expect(router.state.location.pathname).toBe('/pages/42');
  });

  it('asks for the session once, however many consumers a guarded page has', async () => {
    // The loader and the header both need this answer. Two caches make it two
    // round trips on every guarded navigation; the loader's own is the one
    // that would go unnoticed, since the screen still renders.
    withSession();

    renderAt('/dashboard');
    await screen.findByRole('heading', {level: 1, name: 'Your pages'});

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/me', '/api/pages']);
  });

  it('does not treat a broken /me as being signed out', async () => {
    // The failure mode this exists to prevent: a 500 from the session endpoint
    // silently reading as "logged out" and bouncing every signed-in user to a
    // home page, on a backend that could not have logged them in either.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Internal server error'})));

    renderAt('/dashboard');

    expect(await screen.findByRole('heading', {level: 1, name: 'Something went wrong'})).toBeVisible();
  });

  it('renders 404 for an unknown path, inside the shell', async () => {
    renderAt('/nope');

    expect(await screen.findByRole('heading', {level: 1, name: 'Page not found'})).toBeVisible();
    // Inside the shell, so there is still a header and a way out.
    expect(screen.getByRole('link', {name: 'tabstop'})).toBeVisible();
  });

  it('keeps the shell visible while a lazy route’s chunk is still loading, on a direct visit', async () => {
    // The window this closes: `renderAt` mounts the router synchronously, and
    // the dynamic import behind `lazy` cannot resolve inside that same
    // synchronous act() - so these first assertions run DURING the root's
    // `hydrateFallbackElement`, before Signup's chunk has loaded, not after.
    // An empty fallback passes the later assertions and fails these ones; only
    // observing the resolved state below would pass either way and prove
    // nothing.
    renderAt('/signup');

    expect(screen.getByRole('link', {name: 'Skip to content'})).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();

    expect(await screen.findByRole('heading', {level: 1, name: 'Create an account'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Skip to content'})).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('keeps the shell when a screen fails', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Internal server error'})));

    renderAt('/dashboard');

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'Something went wrong'})).toBeVisible();
    });
    expect(screen.getByRole('link', {name: 'Skip to content'})).toBeInTheDocument();
  });
});

describe('what may be split out of the initial chunk', () => {
  const inner = makeRoutes(makeQueryClient())[0]?.children?.[0]?.children ?? [];

  it('keeps the index route eager, because it is the prerendered one', () => {
    // The invariant the prerendering rests on. A lazy Home would leave
    // prerendered markup in index.html with nothing to hydrate it until a
    // second round trip - undoing the change without failing anything else.
    const index = inner.find((route) => route.index === true);

    expect(index?.element).toBeDefined();
    expect(index?.lazy).toBeUndefined();
  });

  it('loads every other screen lazily', () => {
    // Guards the guard: `inner` is derived positionally from the route tree,
    // so a shape change that left it `[]` would make `eager` vacuously `[]`
    // too, passing with nothing checked.
    expect(inner.length).toBeGreaterThan(0);

    const eager = inner.filter((route) => route.index !== true && route.path !== '*' && route.lazy === undefined);

    expect(eager).toEqual([]);
  });

  it('keeps the login screen in a lazy route', () => {
    const login = inner.find((route) => route.path === 'login');

    expect(login?.lazy).toBeTypeOf('function');
    expect(login?.element).toBeUndefined();
  });

  it('keeps the score formula public and split from the initial bundle', () => {
    const scoreFormula = inner.find((route) => route.path === 'docs/score-formula');

    expect(scoreFormula?.handle).toEqual({sessionFree: true});
    expect(scoreFormula?.lazy).toBeTypeOf('function');
    expect(scoreFormula?.element).toBeUndefined();
  });
});
