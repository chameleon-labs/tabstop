import type {AuditResultResponse, LoadPagesResponse, PageHistoryResponse, PageSummary} from '@tabstop/contract';
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

const monitoredPage: PageSummary = {
  id: '42',
  url: 'https://example.com/checkout',
  monitoringEnabled: true,
  createdAt: '2026-08-01T10:00:00.000Z',
  domain: 'example.com',
  latestAudit: {
    auditId: 'abc-123',
    status: 'done',
    score: 74,
    countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
    createdAt: '2026-08-14T12:00:00.000Z',
    completedAt: '2026-08-14T12:00:30.000Z',
    error: null,
  },
  score: 74,
  previousScore: 82,
  history: [
    {score: 82, at: '2026-08-13T12:00:00.000Z'},
    {score: 74, at: '2026-08-14T12:00:00.000Z'},
  ],
  nextAuditAt: null,
};

const pageList: LoadPagesResponse = {pages: [monitoredPage], used: 1, limit: 10};

const pageHistory: PageHistoryResponse = {
  pageId: '42',
  url: monitoredPage.url,
  days: 90,
  points: [
    {
      auditId: 'abc-123',
      createdAt: '2026-08-14T12:00:00.000Z',
      status: 'done',
      score: 74,
      countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
      axeVersion: '4.12.1',
    },
  ],
};
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

  const withSession = (): void => {
    fetchMock.mockImplementation((path) => {
      if (path === '/api/me') {
        return Promise.resolve(jsonResponse(200, signedIn));
      }
      if (path === '/api/pages') {
        return Promise.resolve(jsonResponse(200, pageList));
      }
      if (path.startsWith('/api/pages/42/history')) {
        return Promise.resolve(jsonResponse(200, pageHistory));
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
    renderAt('/');
    await screen.findByRole('heading', {level: 1});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('link', {name: 'Log in'})).toBeVisible();
  });

  it('shows the account header on / when the session is already known', async () => {
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

    expect(await screen.findByRole('heading', {level: 1, name: 'example.com'})).toBeVisible();
    expect(screen.getByText(monitoredPage.url)).toBeVisible();
  });

  it('resolves /r/:uuid without a session, because the uuid is the credential', async () => {
    renderAt('/r/abc-123');

    expect(await screen.findByRole('heading', {level: 1, name: 'example.com'})).toBeVisible();
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

    expect(await screen.findByRole('heading', {level: 1, name: 'Log in'})).toBeVisible();
    expect(screen.queryByRole('heading', {name: 'Your pages'})).not.toBeInTheDocument();
  });

  it('records the complete destination, so login can send them back', async () => {
    const {router} = renderAt('/pages/42?days=30#history');

    await screen.findByRole('heading', {level: 1, name: 'Log in'});

    expect(router.state.location.pathname).toBe('/login');
    expect(destinationFrom(router.state.location.search)).toBe('/pages/42?days=30#history');
  });

  it('replaces the guarded entry rather than pushing over it', async () => {
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

    expect(await screen.findByRole('heading', {level: 1, name: 'example.com'})).toBeVisible();
    expect(router.state.location.pathname).toBe('/pages/42');
    expect(router.state.location.search).toBe('?days=30');
  });

  it('asks for the session once, however many consumers a guarded page has', async () => {
    withSession();

    renderAt('/dashboard');
    await screen.findByRole('heading', {level: 1, name: 'Your pages'});

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/me', '/api/pages']);
  });

  it('does not treat a broken /me as being signed out', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Internal server error'})));

    renderAt('/dashboard');

    expect(await screen.findByRole('heading', {level: 1, name: 'Something went wrong'})).toBeVisible();
  });

  it('renders 404 for an unknown path, inside the shell', async () => {
    renderAt('/nope');

    expect(await screen.findByRole('heading', {level: 1, name: 'Page not found'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'tabstop'})).toBeVisible();
  });

  it('keeps the shell visible while a lazy route’s chunk is still loading, on a direct visit', async () => {
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

  it('holds the shape of the screen while its chunk and its loader are still on the way', async () => {
    withSession();

    renderAt('/dashboard');

    expect(document.querySelector('.route-skeleton')).toHaveAttribute('data-shape', 'dashboard');
    expect(screen.getByRole('link', {name: 'Skip to content'})).toBeInTheDocument();

    expect(await screen.findByRole('heading', {level: 1, name: 'Your pages'})).toBeVisible();
    expect(document.querySelector('.route-skeleton')).not.toBeInTheDocument();
  });

  it('shapes the stand-in to the screen that was asked for', async () => {
    renderAt('/login');

    expect(document.querySelector('.route-skeleton')).toHaveAttribute('data-shape', 'form');

    expect(await screen.findByRole('heading', {level: 1, name: 'Log in'})).toBeVisible();
  });
});

describe('what may be split out of the initial chunk', () => {
  const inner = makeRoutes(makeQueryClient())[0]?.children?.[0]?.children ?? [];

  it('keeps the index route eager, because it is the prerendered one', () => {
    const index = inner.find((route) => route.index === true);

    expect(index?.element).toBeDefined();
    expect(index?.lazy).toBeUndefined();
  });

  it('loads every other screen lazily', () => {
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
