import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {
  AuditResultResponse,
  LoadPagesResponse,
  PageHistoryPoint,
  PageHistoryResponse,
  PageSummary,
} from '@tabstop/contract';
import {jsonResponse} from '@/test/http';
import {PageDetail} from './index';

const URL = 'https://acme.example/checkout';
const DOMAIN = 'acme.example';

const uuid = (digit: string): string =>
  `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;

const scored = (auditId: string, createdAt: string, score: number, axeVersion = '4.12.1'): PageHistoryPoint => ({
  auditId,
  createdAt,
  status: 'done',
  score,
  countsByImpact: {minor: 1, moderate: 2, serious: 0, critical: 1},
  axeVersion,
});

const failedPoint = (auditId: string, createdAt: string): PageHistoryPoint => ({
  auditId,
  createdAt,
  status: 'failed',
  score: null,
  countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
  axeVersion: null,
});

const POINTS: PageHistoryPoint[] = [
  scored(uuid('1'), '2026-08-12T10:00:00.000Z', 90, '4.11.0'),
  failedPoint(uuid('2'), '2026-08-13T10:00:00.000Z'),
  scored(uuid('3'), '2026-08-14T10:00:00.000Z', 82),
  scored(uuid('4'), '2026-08-15T10:00:00.000Z', 74),
];

const LATEST = POINTS[3]!;

const summary = (overrides: Partial<PageSummary> = {}): PageSummary => ({
  id: 'page-1',
  url: URL,
  monitoringEnabled: true,
  createdAt: '2026-08-01T10:00:00.000Z',
  domain: DOMAIN,
  latestAudit: {
    auditId: LATEST.auditId,
    status: 'done',
    score: 74,
    countsByImpact: {minor: 1, moderate: 2, serious: 0, critical: 1},
    createdAt: '2026-08-15T10:00:00.000Z',
    completedAt: '2026-08-15T10:00:30.000Z',
    error: null,
  },
  score: 74,
  previousScore: 82,
  history: [
    {score: 82, at: '2026-08-14T10:00:00.000Z'},
    {score: 74, at: '2026-08-15T10:00:00.000Z'},
  ],
  nextAuditAt: '2026-08-16T05:30:00.000Z',
  ...overrides,
});

const pageList = (pages: PageSummary[] = [summary()]): LoadPagesResponse => ({pages, limit: 10, used: pages.length});

const historyBody = (points: PageHistoryPoint[] = POINTS, days = 90): PageHistoryResponse => ({
  pageId: 'page-1',
  url: URL,
  days,
  points,
});

const auditResult = (): AuditResultResponse => ({
  auditId: LATEST.auditId,
  url: URL,
  status: 'done',
  createdAt: LATEST.createdAt,
  completedAt: '2026-08-15T10:00:30.000Z',
  score: 74,
  countsByImpact: {minor: 1, moderate: 2, serious: 0, critical: 1},
  axeVersion: '4.12.1',
  settled: true,
  error: null,
  violations: [
    {
      ruleId: 'color-contrast',
      impact: 'serious',
      description: 'Elements must have sufficient colour contrast',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/color-contrast',
      nodes: [{target: ['.cta'], html: '<a class="cta">Buy</a>'}],
    },
  ],
});

type Handler = (init?: RequestInit) => Response | Promise<Response>;
type Routes = Record<string, Handler>;

/** Path-aware, so a malformed fixture cannot pass as a different response. */
const routed = (routes: Routes): ReturnType<typeof vi.fn> =>
  vi.fn((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const handler = routes[`${method} ${path}`] ?? routes[path];
    if (handler === undefined) {
      return Promise.resolve(jsonResponse(404, {error: `no route for ${method} ${path}`}));
    }

    return Promise.resolve(handler(init));
  });

const DEFAULT_ROUTES: Routes = {
  '/api/pages': () => jsonResponse(200, pageList()),
  '/api/pages/page-1/history?days=90': () => jsonResponse(200, historyBody()),
  [`/api/audits/${LATEST.auditId}`]: () => jsonResponse(200, auditResult()),
};

let fetchMock: ReturnType<typeof vi.fn>;

const renderDetail = (
  entry = '/pages/page-1',
  routes: Routes = DEFAULT_ROUTES,
): {router: ReturnType<typeof createMemoryRouter>} => {
  fetchMock = routed(routes);
  vi.stubGlobal('fetch', fetchMock);

  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  const router = createMemoryRouter(
    [
      {path: '/pages/:id', element: <PageDetail />},
      {path: '/dashboard', element: <h1>Your pages</h1>},
    ],
    {initialEntries: [entry]},
  );

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return {router};
};

const asked = (fragment: string): boolean =>
  fetchMock.mock.calls.some(([path]) => typeof path === 'string' && path.includes(fragment));

const countFor = (label: string): string =>
  screen.getByText(label).parentElement?.querySelector('dd')?.textContent ?? '';

/** Scoped, because every audit row carries a delta sentence of its own now. */
const summaryCard = (): HTMLElement => document.querySelector<HTMLElement>('.page-detail__summary')!;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PageDetail identity', () => {
  it('names the page by its domain and shows the url it audits', async () => {
    renderDetail();

    expect(await screen.findByRole('heading', {level: 1, name: DOMAIN})).toBeVisible();
    expect(screen.getByText(URL)).toBeVisible();
  });

  it('names the tab after the page, so two open tabs are told apart', async () => {
    renderDetail();
    await screen.findByRole('heading', {level: 1, name: DOMAIN});

    await waitFor(() => {
      expect(document.title).toBe(`${DOMAIN} · tabstop`);
    });
  });

  it('offers the way back to the list it came from', async () => {
    renderDetail();
    await screen.findByRole('heading', {level: 1, name: DOMAIN});

    expect(screen.getByRole('link', {name: 'Your pages'})).toHaveAttribute('href', '/dashboard');
  });
});

describe('PageDetail summary', () => {
  it('leads with the latest result, which is what the reader arrived for', async () => {
    renderDetail();

    expect(await screen.findByText('Score 74 out of 100')).toBeInTheDocument();
    expect(within(summaryCard()).getByText('Score down 8 points since the previous audit')).toBeInTheDocument();
    expect(countFor('Critical')).toBe('1');
    expect(countFor('Serious')).toBe('0');
    expect(countFor('Moderate')).toBe('2');
    expect(countFor('Minor')).toBe('1');
    expect(screen.getByText(/Audited .* ago/)).toBeVisible();
  });

  it('says a retained score is retained, and pairs no counts with it', async () => {
    // `page.score` is the most recent COMPLETED score, not the latest audit's.
    // Labelling it "Score" beside the failed run's counts and timestamp
    // presents fields from two different runs as one result.
    const failedLatest = summary({
      latestAudit: {
        auditId: uuid('9'),
        status: 'failed',
        score: null,
        countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
        createdAt: '2026-08-16T10:00:00.000Z',
        completedAt: null,
        error: 'Navigation timed out',
      },
    });
    renderDetail('/pages/page-1', {
      ...DEFAULT_ROUTES,
      '/api/pages': () => jsonResponse(200, pageList([failedLatest])),
    });

    expect(await screen.findByText('Last successful score 74 out of 100')).toBeInTheDocument();
    expect(screen.queryByText('Score 74 out of 100')).not.toBeInTheDocument();
    expect(screen.queryByText('Critical')).not.toBeInTheDocument();
  });

  it('keeps the counts when they belong to the score beside them', async () => {
    renderDetail();

    expect(await screen.findByText('Score 74 out of 100')).toBeInTheDocument();
    expect(countFor('Critical')).toBe('1');
  });

  it('says when the run will next reach this page', async () => {
    renderDetail();

    expect(await screen.findByText(/Next audit/)).toBeVisible();
  });

  it('says a paused page has no next audit, and why', async () => {
    renderDetail('/pages/page-1', {
      ...DEFAULT_ROUTES,
      '/api/pages': () => jsonResponse(200, pageList([summary({monitoringEnabled: false, nextAuditAt: null})])),
    });

    expect(await screen.findByText('No next audit while monitoring is paused')).toBeVisible();
  });

  it('opens the latest result from the summary', async () => {
    const {router} = renderDetail();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', {name: /view the latest result/i}));

    expect(router.state.location.search).toBe(`?audit=${LATEST.auditId}`);
    expect(await screen.findByText('Elements must have sufficient colour contrast')).toBeVisible();
  });
});

describe('PageDetail history states', () => {
  it('has its heading up before the history arrives, and marks the trend busy', async () => {
    renderDetail('/pages/page-1', {
      ...DEFAULT_ROUTES,
      '/api/pages/page-1/history?days=90': () => Promise.withResolvers<Response>().promise,
    });

    expect(await screen.findByRole('heading', {level: 1, name: DOMAIN})).toBeVisible();
    expect(screen.getByRole('region', {name: 'Score trend'})).toHaveAttribute('aria-busy', 'true');
  });

  it('offers a retry the rest of the page survives', async () => {
    let attempts = 0;
    const {router} = renderDetail('/pages/page-1', {
      ...DEFAULT_ROUTES,
      '/api/pages/page-1/history?days=90': () => {
        attempts += 1;
        return attempts === 1 ? jsonResponse(500, {error: 'Server error'}) : jsonResponse(200, historyBody());
      },
    });
    const user = userEvent.setup();

    expect(await screen.findByText('Server error')).toBeVisible();
    expect(screen.getByRole('heading', {level: 1, name: DOMAIN})).toBeVisible();
    expect(router.state.location.pathname).toBe('/pages/page-1');

    await user.click(screen.getByRole('button', {name: 'Retry'}));

    expect(await screen.findByRole('group', {name: /Score trend: 90 to 74/})).toBeInTheDocument();
  });

  it('explains a missing summary rather than quietly dropping it', async () => {
    // The two queries are independent. When the list fails and the history does
    // not, the trend renders while the summary, the Pause control and the
    // Remove control simply are not there, with nothing said about why.
    let attempts = 0;
    const {router} = renderDetail('/pages/page-1', {
      ...DEFAULT_ROUTES,
      '/api/pages': () => {
        attempts += 1;
        return attempts === 1 ? jsonResponse(500, {error: 'Server error'}) : jsonResponse(200, pageList());
      },
    });
    const user = userEvent.setup();

    expect(await screen.findByText(/could not load this page's details/i)).toBeVisible();
    expect(screen.queryByRole('button', {name: /pause monitoring/i})).not.toBeInTheDocument();
    // The trend is a separate query and is unaffected by the list failing.
    expect(await screen.findByRole('group', {name: /Score trend/})).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/pages/page-1');

    await user.click(screen.getByRole('button', {name: 'Retry details'}));

    expect(await screen.findByRole('button', {name: `Pause monitoring for ${URL}`})).toBeVisible();
  });

  it('says a page that is not yours is not here, and draws nothing', async () => {
    renderDetail('/pages/page-1', {
      '/api/pages': () => jsonResponse(200, pageList([])),
      '/api/pages/page-1/history?days=90': () => jsonResponse(404, {error: 'Page not found'}),
    });

    expect(await screen.findByText(/not one of your monitored pages/i)).toBeVisible();
    expect(screen.queryByRole('group', {name: /Score trend/})).not.toBeInTheDocument();
  });

  it('names the state in the heading rather than falling back to "Page"', async () => {
    // Breadcrumb, heading and tab all read "Page" otherwise, which describes
    // nothing and looks like a screen that failed to finish loading.
    renderDetail('/pages/page-1', {
      '/api/pages': () => jsonResponse(200, pageList([])),
      '/api/pages/page-1/history?days=90': () => jsonResponse(404, {error: 'Page not found'}),
    });

    expect(await screen.findByRole('heading', {level: 1, name: 'Page not found'})).toBeVisible();
    await waitFor(() => {
      expect(document.title).toBe('Page not found · tabstop');
    });
  });

  it('offers the way back as a control, not a bare browser link', async () => {
    renderDetail('/pages/page-1', {
      '/api/pages': () => jsonResponse(200, pageList([])),
      '/api/pages/page-1/history?days=90': () => jsonResponse(404, {error: 'Page not found'}),
    });

    expect(await screen.findByRole('link', {name: 'Back to your pages'})).toHaveAttribute('href', '/dashboard');
  });

  it('says the window is empty once, not once per section', async () => {
    // The trend and the audit list carry the same sentence, and two of them on
    // one screen reads as a fault rather than as an empty window.
    renderDetail('/pages/page-1', {
      ...DEFAULT_ROUTES,
      '/api/pages/page-1/history?days=90': () => jsonResponse(200, historyBody([])),
    });

    expect(await screen.findByText(/no audits in this window/i)).toBeVisible();
    expect(screen.getAllByText(/no audits in this window/i)).toHaveLength(1);
    expect(screen.queryByRole('heading', {name: 'Audits'})).not.toBeInTheDocument();
  });
});

describe('PageDetail window', () => {
  it('puts the chosen window in the url and asks for it', async () => {
    const {router} = renderDetail('/pages/page-1', {
      ...DEFAULT_ROUTES,
      '/api/pages/page-1/history?days=30': () => jsonResponse(200, historyBody(POINTS.slice(-2), 30)),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('radio', {name: '30 days'}));

    expect(router.state.location.search).toBe('?days=30');
    await waitFor(() => {
      expect(asked('history?days=30')).toBe(true);
    });
  });

  it('replaces rather than pushes, so Back leaves the page', async () => {
    // Changing a view is not a navigation. Pushing would make Back walk through
    // every window the reader tried before it left the screen.
    const {router} = renderDetail('/pages/page-1', {
      ...DEFAULT_ROUTES,
      '/api/pages/page-1/history?days=30': () => jsonResponse(200, historyBody(POINTS.slice(-2), 30)),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('radio', {name: '30 days'}));

    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('starts on the window the url names, so a link keeps its meaning', async () => {
    renderDetail('/pages/page-1?days=365', {
      ...DEFAULT_ROUTES,
      '/api/pages/page-1/history?days=365': () => jsonResponse(200, historyBody(POINTS, 365)),
    });

    expect(await screen.findByRole('radio', {name: '365 days', checked: true})).toBeInTheDocument();
    expect(asked('history?days=365')).toBe(true);
  });

  it.each(['weekly', '1000'])('never passes on ?days=%s, which the server would refuse or clamp', async (value) => {
    // 1000 is the dangerous one: the server clamps it to 365 rather than
    // rejecting it, so passing it through leaves the control reading one window
    // and the chart drawn from another.
    renderDetail(`/pages/page-1?days=${value}`);

    await screen.findByRole('heading', {level: 1, name: DOMAIN});
    await waitFor(() => {
      expect(asked('history?days=90')).toBe(true);
    });
    expect(asked(`days=${value}`)).toBe(false);
  });
});

describe('PageDetail table toggle', () => {
  it('swaps the chart for a table and back, over the same audits', async () => {
    renderDetail();
    const user = userEvent.setup();
    const toggle = await screen.findByRole('button', {name: 'View as table'});
    await screen.findByRole('group', {name: /Score trend/});

    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const plotted = screen.getAllByRole('img').length;

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('group', {name: /Score trend/})).not.toBeInTheDocument();
    expect(within(screen.getAllByRole('rowgroup')[1]!).getAllByRole('row')).toHaveLength(plotted);

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', {name: /Score trend/})).toBeInTheDocument();
  });

  it('keeps the chosen view in the url, so a reload and a shared link both keep it', async () => {
    const {router} = renderDetail();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', {name: 'View as table'}));

    expect(router.state.location.search).toBe('?view=table');
    // A view, like the window: Back leaves the page rather than undoing it.
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('starts on the table when the url asks for it', async () => {
    renderDetail('/pages/page-1?view=table');

    expect(await screen.findByRole('table', {name: /Score history for acme.example/})).toBeVisible();
    expect(screen.getByRole('button', {name: 'View as table'})).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('PageDetail audit panel', () => {
  it('opens an audit into the url, and Back closes it again', async () => {
    const {router} = renderDetail();
    const user = userEvent.setup();

    const controls = await screen.findAllByRole('button', {name: /view result for/i});
    await user.click(controls[0]!);

    expect(router.state.location.search).toBe(`?audit=${LATEST.auditId}`);
    expect(router.state.historyAction).toBe('PUSH');
    expect(await screen.findByText('Elements must have sufficient colour contrast')).toBeVisible();

    await act(async () => {
      await router.navigate(-1);
    });

    await waitFor(() => {
      expect(screen.queryByText('Elements must have sufficient colour contrast')).not.toBeInTheDocument();
    });
  });

  it('renders the audit a cold link names, without a click', async () => {
    renderDetail(`/pages/page-1?audit=${LATEST.auditId}`);

    expect(await screen.findByText('Elements must have sufficient colour contrast')).toBeVisible();
  });
});

describe('PageDetail page controls', () => {
  it('pauses monitoring through the same mutation the dashboard uses', async () => {
    renderDetail('/pages/page-1', {
      ...DEFAULT_ROUTES,
      'PATCH /api/pages/page-1': () =>
        jsonResponse(200, {id: 'page-1', url: URL, monitoringEnabled: false, createdAt: '2026-08-01T10:00:00.000Z'}),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', {name: `Pause monitoring for ${URL}`}));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/pages/page-1',
        expect.objectContaining({method: 'PATCH', body: JSON.stringify({monitoringEnabled: false})}),
      );
    });
  });

  it('leaves for the list once the page it was showing is gone', async () => {
    renderDetail('/pages/page-1', {
      ...DEFAULT_ROUTES,
      'DELETE /api/pages/page-1': () => new Response(null, {status: 204}),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', {name: `Remove ${URL}`}));
    await user.click(await screen.findByRole('button', {name: 'Remove page'}));

    expect(await screen.findByRole('heading', {level: 1, name: 'Your pages'})).toBeVisible();
  });
});

describe('PageDetail announcements', () => {
  it('announces each chart point through one region, not one region per point', async () => {
    renderDetail();
    const user = userEvent.setup();
    await screen.findByRole('group', {name: /Score trend/});

    expect(screen.getAllByRole('status')).toHaveLength(1);

    act(() => {
      screen.getAllByRole('img')[0]!.focus();
    });
    await user.keyboard('{ArrowRight}');

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/13 August 2026|August 13, 2026/);
    });
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  describe('auditing on demand', () => {
    const auditNowButton = (): HTMLElement => screen.getByRole('button', {name: `Audit ${URL} now`});
    const auditingButton = (): HTMLElement => screen.getByRole('button', {name: `Auditing ${URL}`});
    const acceptedAudit = {auditId: uuid('9'), status: 'queued', pollAfterMs: 2000};

    it('asks the page own endpoint, so the result belongs to this page', async () => {
      renderDetail('/pages/page-1', {
        ...DEFAULT_ROUTES,
        'POST /api/pages/page-1/audits': () =>
          jsonResponse(202, {auditId: uuid('9'), status: 'queued', pollAfterMs: 2000}),
      });
      await screen.findByRole('heading', {level: 1, name: DOMAIN});

      await userEvent.click(auditNowButton());

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/pages/page-1/audits', expect.objectContaining({method: 'POST'}));
      });
    });

    it('will not ask again while an audit for this page is already running', async () => {
      // The refusal the server would send anyway, spent before the request
      // rather than after it. The ACCESSIBLE NAME carries the state as well as
      // the visible text: a fixed label reading "Audit now" on a disabled
      // control tells a screen reader user the opposite of what is happening.
      renderDetail('/pages/page-1', {
        ...DEFAULT_ROUTES,
        '/api/pages': () =>
          jsonResponse(200, pageList([summary({latestAudit: {...summary().latestAudit!, status: 'running'}})])),
      });
      await screen.findByRole('heading', {level: 1, name: DOMAIN});

      await waitFor(() => {
        expect(auditingButton()).toBeDisabled();
      });
      expect(auditingButton()).toHaveTextContent('Auditing');
      expect(screen.queryByRole('button', {name: `Audit ${URL} now`})).not.toBeInTheDocument();
    });

    it('polls the audit it started and shows its phase in place', async () => {
      // The accepted response carries an id and a poll interval, and #115 asks
      // for progress on this screen rather than a button that merely greys out.
      renderDetail('/pages/page-1', {
        ...DEFAULT_ROUTES,
        'POST /api/pages/page-1/audits': () => jsonResponse(202, acceptedAudit),
        [`/api/audits/${uuid('9')}`]: () =>
          jsonResponse(200, {...auditResult(), auditId: uuid('9'), status: 'running'}),
      });
      await screen.findByRole('heading', {level: 1, name: DOMAIN});

      await userEvent.click(auditNowButton());

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(`/api/audits/${uuid('9')}`, expect.anything());
      });
    });

    it('says the audit finished once the one it started is done', async () => {
      renderDetail('/pages/page-1', {
        ...DEFAULT_ROUTES,
        'POST /api/pages/page-1/audits': () => jsonResponse(202, acceptedAudit),
        [`/api/audits/${uuid('9')}`]: () => jsonResponse(200, {...auditResult(), auditId: uuid('9'), status: 'done'}),
      });
      await screen.findByRole('heading', {level: 1, name: DOMAIN});

      await userEvent.click(auditNowButton());

      expect(await screen.findByText('Audit finished')).toBeInTheDocument();
    });

    it('shows the refusal sentence and when the allowance comes back', async () => {
      renderDetail('/pages/page-1', {
        ...DEFAULT_ROUTES,
        'POST /api/pages/page-1/audits': () =>
          jsonResponse(409, {
            code: 'on_demand_audit_spent',
            error: 'You have used your audit for today',
            resetAt: '2036-08-19T00:00:00.000Z',
          }),
      });
      await screen.findByRole('heading', {level: 1, name: DOMAIN});

      await userEvent.click(auditNowButton());

      expect(await screen.findByText(/You have used your audit for today/)).toBeInTheDocument();
      expect(screen.getByText(/The next one is available/)).toBeInTheDocument();
    });

    it('says a page is already being audited rather than failing silently', async () => {
      renderDetail('/pages/page-1', {
        ...DEFAULT_ROUTES,
        'POST /api/pages/page-1/audits': () =>
          jsonResponse(409, {code: 'audit_in_flight', error: 'This page is already being audited'}),
      });
      await screen.findByRole('heading', {level: 1, name: DOMAIN});

      await userEvent.click(auditNowButton());

      expect(await screen.findByText('This page is already being audited')).toBeInTheDocument();
    });

    it('keeps the trend and the controls when a request is refused', async () => {
      // A refusal is not a broken screen. The reader still has the page they
      // came for, and a control they can use again tomorrow.
      renderDetail('/pages/page-1', {
        ...DEFAULT_ROUTES,
        'POST /api/pages/page-1/audits': () =>
          jsonResponse(409, {code: 'audit_in_flight', error: 'This page is already being audited'}),
      });
      await screen.findByRole('heading', {level: 1, name: DOMAIN});

      await userEvent.click(auditNowButton());
      await screen.findByText('This page is already being audited');

      expect(screen.getByRole('heading', {level: 1, name: DOMAIN})).toBeInTheDocument();
      expect(screen.getByRole('button', {name: `Pause monitoring for ${URL}`})).toBeInTheDocument();
    });
  });
});
