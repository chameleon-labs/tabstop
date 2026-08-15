import {focusManager} from '@tanstack/react-query';
import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {AuditStatus, LoadPagesResponse, PageSummary} from '@tabstop/contract';
import {jsonResponse} from '@/test/http';
import {Providers} from '@/test/render';
import {Dashboard} from './index';

const URL_A = 'https://example.test/checkout';

const page = (
  id: string,
  url: string,
  status: AuditStatus | null = 'done',
  score: number | null = 74,
): PageSummary => ({
  id,
  url,
  monitoringEnabled: true,
  createdAt: '2026-08-01T10:00:00.000Z',
  domain: 'example.test',
  latestAudit:
    status === null
      ? null
      : {
          auditId: `audit-${id}`,
          status,
          score,
          countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
          createdAt: '2026-08-15T10:00:00.000Z',
          completedAt: status === 'done' ? '2026-08-15T10:01:00.000Z' : null,
          error: null,
        },
  score,
  previousScore: score === null ? null : score + 8,
  history:
    score === null
      ? []
      : [
          {score: score + 8, at: '2026-08-14T10:00:00.000Z'},
          {score, at: '2026-08-15T10:00:00.000Z'},
        ],
});

const list = (pages: PageSummary[], limit = 10): LoadPagesResponse => ({pages, limit, used: pages.length});

type Routes = Record<string, (init?: RequestInit) => Response | Promise<Response>>;

/** Path-aware, so a poll or a refetch cannot be mistaken for the next answer. */
const routed = (routes: Routes): ReturnType<typeof vi.fn> =>
  vi.fn((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const handler = routes[`${method} ${path}`] ?? routes[path];
    if (handler === undefined) {
      return Promise.resolve(jsonResponse(404, {error: `no route for ${method} ${path}`}));
    }

    return Promise.resolve(handler(init));
  });

const rows = (): HTMLElement[] => within(screen.getByRole('list', {name: 'Monitored pages'})).getAllByRole('listitem');

/**
 * The same rows while the removal dialog is open. Ariakit aria-hides the page
 * behind a modal, which is correct, so counting what survived a failed removal
 * has to say that it is looking behind it.
 */
const rowsBehindDialog = (): HTMLElement[] =>
  within(screen.getByRole('list', {name: 'Monitored pages', hidden: true})).getAllByRole('listitem', {hidden: true});

/** Scoped to the visible stack: the live region repeats every message. */
const toast = (text: string | RegExp): HTMLElement =>
  within(screen.getByRole('list', {name: 'Notifications'})).getByText(text);

const renderDashboard = () =>
  render(
    <Providers>
      <Dashboard />
    </Providers>,
  );

let fetchMock: ReturnType<typeof vi.fn>;

const stub = (routes: Routes): void => {
  fetchMock = routed(routes);
  vi.stubGlobal('fetch', fetchMock);
};

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Dashboard first paint', () => {
  it('names itself while the list is still arriving', async () => {
    let release!: (value: Response) => void;
    stub({
      '/api/pages': async () =>
        await new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });
    renderDashboard();

    expect(screen.getByRole('heading', {level: 1, name: 'Your pages'})).toBeVisible();
    expect(document.title).toBe('Dashboard · tabstop');
    expect(screen.getByText('Loading monitored pages…')).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      release(jsonResponse(200, list([])));
      await Promise.resolve();
    });
  });

  it('offers a way back when the first load fails', async () => {
    let attempt = 0;
    stub({
      '/api/pages': () => {
        attempt += 1;
        return attempt === 1 ? jsonResponse(500, {error: 'Server error'}) : jsonResponse(200, list([]));
      },
    });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Could not load your pages')).toBeVisible();
    });
    // Not announced: nothing changed under the reader, this is the page.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', {name: 'Retry'}));

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'No pages monitored yet'})).toBeVisible();
    });
  });
});

describe('Dashboard empty state', () => {
  it('puts the field itself in front of a new account', async () => {
    // The only useful thing to do here is add a page, so the form is the
    // empty state rather than a button pointing at one.
    stub({'/api/pages': () => jsonResponse(200, list([]))});
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'No pages monitored yet'})).toBeVisible();
    });
    expect(screen.getByLabelText('Page URL')).toBeVisible();
    expect(screen.getByText('0 of 10 pages')).toBeVisible();
    expect(screen.queryByRole('list', {name: 'Monitored pages'})).not.toBeInTheDocument();
  });
});

describe('Dashboard populated state', () => {
  it('keeps the order the server sent', async () => {
    stub({
      '/api/pages': () =>
        jsonResponse(
          200,
          list([
            page('page-1', 'https://example.test/c'),
            page('page-2', 'https://example.test/a'),
            page('page-3', 'https://example.test/b'),
          ]),
        ),
    });
    renderDashboard();

    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    expect(rows().map((row) => within(row).getByRole('link').getAttribute('href'))).toEqual([
      '/pages/page-1',
      '/pages/page-2',
      '/pages/page-3',
    ]);
    expect(screen.getByText('3 of 10 pages')).toBeVisible();
  });

  it('closes the form at the limit and says why', async () => {
    const pages = Array.from({length: 10}, (_, index) => page(`page-${index}`, `https://example.test/${index}`));
    stub({'/api/pages': () => jsonResponse(200, list(pages))});
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('10 of 10 pages')).toBeVisible();
    });
    expect(screen.getByLabelText('Page URL')).toBeDisabled();
    expect(screen.getByText(/Remove a page before adding another/)).toBeVisible();
  });
});

describe('Dashboard adding a page', () => {
  it('stays put and lets polling turn the new row into a score', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stub({
      'POST /api/pages': () =>
        jsonResponse(201, {
          id: 'page-1',
          url: 'https://example.com/',
          monitoringEnabled: true,
          createdAt: '2026-08-15T12:00:00.000Z',
          firstAuditId: 'audit-1',
        }),
      '/api/pages': () => {
        reads += 1;
        if (reads === 1) {
          return jsonResponse(200, list([]));
        }
        if (reads === 2) {
          return jsonResponse(200, list([page('page-1', 'https://example.com/', 'queued', null)]));
        }
        return jsonResponse(200, list([page('page-1', 'https://example.com/', 'done', 74)]));
      },
    });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByLabelText('Page URL')).toBeVisible();
    });

    await user.type(screen.getByLabelText('Page URL'), 'example.com');
    await user.click(screen.getByRole('button', {name: 'Add page'}));

    await waitFor(() => {
      expect(toast('Page added: https://example.com/')).toBeVisible();
    });
    expect(screen.getByText(/First audit: /)).toBeVisible();

    // The refresh is triggered rather than waited for. That the interval is
    // two seconds while an audit runs is proven at the data boundary; what
    // matters here is that a refreshed list turns the row into a score and
    // announces it exactly once.
    act(() => {
      focusManager.setFocused(false);
    });
    act(() => {
      focusManager.setFocused(true);
    });

    await waitFor(() => {
      expect(screen.getByRole('list', {name: 'Monitored pages'}).querySelector('.page-row__score')?.textContent).toBe(
        'Score 74 out of 100',
      );
    });
    await waitFor(() => {
      expect(toast('First audit complete for https://example.com/. Score 74.')).toBeVisible();
    });
  });

  it('warns when the page is monitored but its first audit never started', async () => {
    const user = userEvent.setup();
    stub({
      'POST /api/pages': () =>
        jsonResponse(201, {
          id: 'page-1',
          url: 'https://example.com/',
          monitoringEnabled: true,
          createdAt: '2026-08-15T12:00:00.000Z',
          firstAuditId: null,
        }),
      '/api/pages': () => jsonResponse(200, list([])),
    });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByLabelText('Page URL')).toBeVisible();
    });
    await user.type(screen.getByLabelText('Page URL'), 'example.com');
    await user.click(screen.getByRole('button', {name: 'Add page'}));

    await waitFor(() => {
      expect(toast(/its first audit could not start/)).toBeVisible();
    });
  });

  it('points at the page that is already tracked', async () => {
    const user = userEvent.setup();
    stub({
      'POST /api/pages': () =>
        jsonResponse(409, {code: 'page_already_tracked', error: 'You are already monitoring that page.'}),
      '/api/pages': () => jsonResponse(200, list([page('page-1', 'https://example.com/')])),
    });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByLabelText('Page URL')).toBeVisible();
    });
    await user.type(screen.getByLabelText('Page URL'), 'example.com');
    await user.click(screen.getByRole('button', {name: 'Add page'}));

    await waitFor(() => {
      expect(toast('You are already monitoring that page.')).toBeVisible();
    });
    expect(screen.getByRole('button', {name: 'View page'})).toBeVisible();
  });

  it('refreshes the count when the server says the limit is already reached', async () => {
    // The cached count said there was room, so another tab filled the slot.
    const user = userEvent.setup();
    let reads = 0;
    const full = Array.from({length: 10}, (_, index) => page(`page-${index}`, `https://example.test/${index}`));
    stub({
      'POST /api/pages': () =>
        jsonResponse(409, {
          code: 'page_limit_reached',
          error: 'You are already monitoring 10 pages.',
          limit: 10,
        }),
      '/api/pages': () => {
        reads += 1;
        return jsonResponse(200, reads === 1 ? list([]) : list(full));
      },
    });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByLabelText('Page URL')).toBeVisible();
    });
    await user.type(screen.getByLabelText('Page URL'), 'example.com');
    await user.click(screen.getByRole('button', {name: 'Add page'}));

    await waitFor(() => {
      expect(toast('You are already monitoring 10 pages.')).toBeVisible();
    });
    await waitFor(() => {
      expect(screen.getByText('10 of 10 pages')).toBeVisible();
    });
    expect(screen.getByLabelText('Page URL')).toBeDisabled();
  });

  it('keeps the typed url when the request fails outright', async () => {
    const user = userEvent.setup();
    stub({
      'POST /api/pages': () => jsonResponse(500, {error: 'Server error'}),
      '/api/pages': () => jsonResponse(200, list([])),
    });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByLabelText('Page URL')).toBeVisible();
    });
    await user.type(screen.getByLabelText('Page URL'), 'example.com');
    await user.click(screen.getByRole('button', {name: 'Add page'}));

    await waitFor(() => {
      expect(toast('Server error')).toBeVisible();
    });
    expect(screen.getByLabelText('Page URL')).toHaveValue('example.com');
  });
});

describe('Dashboard background failures', () => {
  it('keeps the rows it has, reports once, and stops polling', async () => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    let reads = 0;
    stub({
      '/api/pages': () => {
        reads += 1;
        return reads === 1
          ? jsonResponse(200, list([page('page-1', URL_A, 'running', null)]))
          : jsonResponse(500, {error: 'Server error'});
      },
    });
    renderDashboard();

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    await waitFor(() => {
      expect(toast(/Could not refresh your pages/)).toBeVisible();
    });
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole('button', {name: 'Retry'})).toBeVisible();

    const afterFailure = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(afterFailure);
  });
});

describe('Dashboard removing a page', () => {
  const twoPages = [page('page-1', URL_A), page('page-2', 'https://example.test/pricing')];

  it('asks first, and sends nothing until it is answered', async () => {
    const user = userEvent.setup();
    stub({'/api/pages': () => jsonResponse(200, list(twoPages))});
    renderDashboard();

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    await user.click(screen.getByRole('button', {name: `Remove ${URL_A}`}));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeVisible();
    });
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(expect.stringContaining(URL_A));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  });

  it('keeps the row and says so when removal fails', async () => {
    const user = userEvent.setup();
    stub({
      '/api/pages': () => jsonResponse(200, list(twoPages)),
      'DELETE /api/pages/page-1': () => jsonResponse(500, {error: 'Server error'}),
    });
    renderDashboard();

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    await user.click(screen.getByRole('button', {name: `Remove ${URL_A}`}));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeVisible();
    });
    await user.click(screen.getByRole('button', {name: 'Remove page'}));

    await waitFor(() => {
      expect(within(screen.getByRole('dialog')).getByText(/Could not remove/)).toBeVisible();
    });
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(rowsBehindDialog()).toHaveLength(2);
  });

  it('moves focus to the list heading, because the button it came from is gone', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stub({
      '/api/pages': () => {
        reads += 1;
        return jsonResponse(200, reads === 1 ? list(twoPages) : list([twoPages[1]!]));
      },
      'DELETE /api/pages/page-1': () => new Response(null, {status: 204}),
    });
    renderDashboard();

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    await user.click(screen.getByRole('button', {name: `Remove ${URL_A}`}));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeVisible();
    });
    await user.click(screen.getByRole('button', {name: 'Remove page'}));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'Monitored pages'})).toHaveFocus();
    });
    expect(toast(`Page removed: ${URL_A}`)).toBeVisible();
  });

  it('moves focus to the url field when the last page goes', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stub({
      '/api/pages': () => {
        reads += 1;
        return jsonResponse(200, reads === 1 ? list([page('page-1', URL_A)]) : list([]));
      },
      'DELETE /api/pages/page-1': () => new Response(null, {status: 204}),
    });
    renderDashboard();

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    await user.click(screen.getByRole('button', {name: `Remove ${URL_A}`}));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeVisible();
    });
    await user.click(screen.getByRole('button', {name: 'Remove page'}));

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'No pages monitored yet'})).toBeVisible();
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Page URL')).toHaveFocus();
    });
  });
});
