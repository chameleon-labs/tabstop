import type {AuditResultResponse} from '@tabstop/contract';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {makeQueryClient} from '@/api/query-client';
import {ANNOUNCE_DELAY_MS} from '@/a11y/announce';
import {jsonResponse} from '@/test/http';
import {FALLBACK_POLL_AFTER_MS} from '../../audits';
import {COMPLETE_HOLD_MS, FAST_PHASE_MS, PROGRESS_EXIT_MS, SCORING_HOLD_MS} from '../../hooks/use-audit-presentation';
import {startedHere} from '../../share';
import {Share} from './index';

const UUID = '3f2b';

const auditBody = (over: Partial<AuditResultResponse> = {}): AuditResultResponse => ({
  auditId: UUID,
  url: 'https://example.com/checkout',
  status: 'done',
  createdAt: '2026-08-03T09:00:00.000Z',
  completedAt: '2026-08-03T09:00:30.000Z',
  score: 72,
  countsByImpact: {minor: 2, moderate: 0, serious: 5, critical: 3},
  axeVersion: '4.12.1',
  settled: true,
  error: null,
  violations: [
    {
      ruleId: 'image-alt',
      impact: 'critical',
      description: 'Images need alt text',
      helpUrl: 'https://example.test',
      nodes: [{target: ['img'], html: '<img src=x>'}],
    },
  ],
  ...over,
});

const server = (...responses: (() => Response)[]): ReturnType<typeof vi.fn> => {
  let call = 0;
  const mock = vi.fn(() => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return Promise.resolve(next?.() ?? jsonResponse(200, auditBody()));
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};

const withClipboard = (): ReturnType<typeof vi.fn> => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});
  return writeText;
};

const renderShare = ({
  client = new QueryClient({defaultOptions: {queries: {retry: false}}}),
  owner = false,
}: {client?: QueryClient; owner?: boolean} = {}) => {
  const router = createMemoryRouter(
    [
      {path: '/', element: <h1>Home screen</h1>},
      {path: '/r/:uuid', element: <Share />},
    ],
    {initialEntries: [owner ? {pathname: `/r/${UUID}`, state: startedHere()} : `/r/${UUID}`]},
  );

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return router;
};

const statusLine = (): HTMLElement => {
  const regions = screen.getAllByRole('status').filter((region) => region.getAttribute('aria-atomic') === 'true');
  const last = regions[regions.length - 1];
  if (last === undefined) {
    throw new Error('no atomic status region rendered');
  }
  return last;
};

const result = async (): Promise<HTMLElement> =>
  await screen.findByRole('heading', {name: /Result for https:\/\/example\.com\/checkout/});

describe('the share screen', () => {
  beforeEach(() => {
    server();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'clipboard', {value: undefined, configurable: true});
  });

  it('shows the whole result to someone with no account', async () => {
    renderShare();

    expect(await result()).toBeVisible();
    expect(screen.getByText('72')).toBeVisible();
    expect(screen.getByRole('region', {name: 'Violations — 1 total'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /^critical image-alt Images need alt text/})).toBeVisible();
  });

  it('names the page in the title, which is also what the route announcer reads', async () => {
    renderShare();
    await result();

    expect(document.title).toBe('Audit result · tabstop');
  });

  it('asks for the audit and for nothing else', async () => {
    const fetchMock = server();
    renderShare();
    await result();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([`/api/audits/${UUID}`]);
  });

  it('renders no field the contract does not carry, even when the API grows one', async () => {
    server(() => jsonResponse(200, {...auditBody(), ownerEmail: 'ada@example.test', pageId: 41}));
    renderShare();
    await result();

    expect(document.body.textContent).not.toContain('ada@example.test');
  });

  it('offers the canonical link to copy, not the address someone arrived on', async () => {
    const writeText = withClipboard();
    renderShare();
    await result();

    await userEvent.click(screen.getByRole('button', {name: 'Copy link'}));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/r/${UUID}`);
  });

  describe('a link opened before the audit finished', () => {
    it('shows Scoring and all-complete before revealing a fast result', async () => {
      vi.useFakeTimers({shouldAdvanceTime: true});
      server(
        () => jsonResponse(200, auditBody({status: 'running', score: null, completedAt: null, violations: []})),
        () => jsonResponse(200, auditBody()),
      );
      renderShare({owner: true});

      await waitFor(() => expect(screen.getByText('Fetching the page…')).toBeVisible());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FALLBACK_POLL_AFTER_MS);
      });

      expect(screen.queryByRole('heading', {name: /Result for/})).not.toBeInTheDocument();
      expect(screen.getByText('Running the accessibility engine…')).toBeVisible();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(FAST_PHASE_MS);
      });
      expect(screen.getByText('Scoring…')).toBeVisible();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SCORING_HOLD_MS);
      });
      expect(screen.getByText('3/3 steps')).toBeVisible();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COMPLETE_HOLD_MS + PROGRESS_EXIT_MS);
      });
      expect(await result()).toBeVisible();
    });

    it('uses the focused screen during first lookup and queueing', async () => {
      let answer = (_response: Response): void => undefined;
      const held = new Promise<Response>((resolve) => {
        answer = resolve;
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(() => held),
      );
      renderShare({owner: true});

      expect(screen.getByRole('heading', {level: 1, name: 'Audit in progress'})).toBeInTheDocument();
      expect(screen.getByText('Looking for that audit…')).toBeVisible();
      expect(screen.queryByRole('heading', {name: /Result for/})).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', {name: 'Keep an eye on this page'})).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', {name: 'Check your own site'})).not.toBeInTheDocument();

      answer(jsonResponse(200, auditBody({status: 'queued', score: null, completedAt: null, violations: []})));

      expect(await screen.findByText('Waiting for a free worker…')).toBeVisible();
      expect(screen.getByText('0/3 steps')).toBeVisible();
    });

    it('does not delay a historical completed link', async () => {
      server(() => jsonResponse(200, auditBody()));
      renderShare();

      expect(await result()).toBeVisible();
    });

    it('plays all phases when an owner first observes done', async () => {
      vi.useFakeTimers({shouldAdvanceTime: true});
      server(() => jsonResponse(200, auditBody()));
      renderShare({owner: true});

      await waitFor(() => expect(screen.getByText('Fetching the page…')).toBeVisible());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(FAST_PHASE_MS);
      });
      expect(screen.getByText('Running the accessibility engine…')).toBeVisible();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(FAST_PHASE_MS);
      });
      expect(screen.getByText('Scoring…')).toBeVisible();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SCORING_HOLD_MS);
      });
      expect(screen.getByText('3/3 steps')).toBeVisible();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COMPLETE_HOLD_MS);
      });
      expect(document.querySelector('.report-page')).toHaveAttribute('data-view', 'exiting');
      expect(screen.queryByRole('heading', {name: /Result for/})).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(PROGRESS_EXIT_MS);
      });
      expect(await result()).toBeVisible();
    });

    it('does not announce synthetic finish phases', async () => {
      vi.useFakeTimers({shouldAdvanceTime: true});
      server(() => jsonResponse(200, auditBody()));
      renderShare({owner: true});

      await waitFor(() => expect(screen.getByText('Fetching the page…')).toBeVisible());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FAST_PHASE_MS * 2);
      });

      expect(screen.getByText('Scoring…')).toBeVisible();
      expect(within(statusLine()).queryByText(/Scoring/, {selector: '.visually-hidden'})).not.toBeInTheDocument();
      expect(
        within(statusLine()).queryByText(/Audit complete/, {selector: '.visually-hidden'}),
      ).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SCORING_HOLD_MS + COMPLETE_HOLD_MS + PROGRESS_EXIT_MS);
      });
      expect(await result()).toBeVisible();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ANNOUNCE_DELAY_MS);
      });
      expect(within(statusLine()).getByText(/Audit complete/, {selector: '.visually-hidden'})).toBeInTheDocument();
    });

    it('announces completion to a non-owner who observed the audit running', async () => {
      vi.useFakeTimers({shouldAdvanceTime: true});
      server(
        () => jsonResponse(200, auditBody({status: 'running', score: null, completedAt: null, violations: []})),
        () => jsonResponse(200, auditBody()),
      );
      renderShare();

      await waitFor(() => expect(screen.getByText('Fetching the page…')).toBeVisible());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          FALLBACK_POLL_AFTER_MS + FAST_PHASE_MS + SCORING_HOLD_MS + COMPLETE_HOLD_MS + PROGRESS_EXIT_MS,
        );
      });
      expect(await result()).toBeVisible();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ANNOUNCE_DELAY_MS);
      });
      expect(statusLine()).toHaveTextContent('Audit complete. Score 72. 1 issue found.');
    });
  });

  describe('a uuid that names nothing', () => {
    it('is a page, not a spinner, and is asked about exactly once', async () => {
      vi.useFakeTimers({shouldAdvanceTime: true});
      const fetchMock = server(() => jsonResponse(404, {error: 'No audit with that id'}));

      renderShare({client: makeQueryClient()});

      expect(await screen.findByRole('heading', {level: 1, name: 'Page not found'})).toBeVisible();
      expect(screen.getByRole('link', {name: /Back to the start/})).toBeVisible();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('an audit that failed', () => {
    it('uses the failure title as the page heading when the report header is absent', async () => {
      server(() =>
        jsonResponse(200, auditBody({status: 'failed', score: null, error: 'The page took too long to load'})),
      );
      renderShare();

      expect(await screen.findByRole('heading', {level: 1, name: 'That audit did not finish'})).toBeVisible();
    });

    it('withdraws the first retry once a re-run is under way, so it cannot be sent twice', async () => {
      server(
        () => jsonResponse(200, auditBody({status: 'failed', score: null, error: 'The page took too long to load'})),
        () => jsonResponse(429, {error: 'Too many requests', retryAfter: 45, resetAt: '2026-08-13T10:00:00.000Z'}),
      );
      renderShare({owner: true});

      await userEvent.click(await screen.findByRole('button', {name: 'Try again'}));
      await screen.findByRole('heading', {name: 'You have used your free audits'});

      expect(screen.queryByRole('button', {name: 'Try again'})).not.toBeInTheDocument();
    });

    it('says why a re-run was refused, rather than swallowing it', async () => {
      server(
        () => jsonResponse(200, auditBody({status: 'failed', score: null, error: 'The page took too long to load'})),
        () => jsonResponse(429, {error: 'Too many requests', retryAfter: 45, resetAt: '2026-08-13T10:00:00.000Z'}),
      );
      renderShare({owner: true});

      await userEvent.click(await screen.findByRole('button', {name: 'Try again'}));

      expect(await screen.findByRole('heading', {name: 'You have used your free audits'})).toBeVisible();
    });

    it('quotes the server and offers no retry, because there is nothing here to retry', async () => {
      server(() =>
        jsonResponse(200, auditBody({status: 'failed', score: null, error: 'The page took too long to load'})),
      );
      renderShare();

      expect(await screen.findByText('The page took too long to load')).toBeVisible();
      expect(screen.queryByRole('button', {name: 'Try again'})).not.toBeInTheDocument();
    });
  });

  describe('a poll that failed', () => {
    it('offers a retry that asks again', async () => {
      const fetchMock = server(
        () => jsonResponse(500, {error: 'Internal server error'}),
        () => jsonResponse(200, auditBody()),
      );
      renderShare();

      await userEvent.click(await screen.findByRole('button', {name: 'Try again'}));

      expect(await result()).toBeVisible();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('what the audit itself does, once this page owns the wait', () => {
    it('offers a retry when the audit itself failed', async () => {
      server(() =>
        jsonResponse(
          200,
          auditBody({
            status: 'failed',
            error: 'The page took too long to load',
            score: null,
            violations: [],
          }),
        ),
      );
      renderShare({owner: true});

      expect(await screen.findByText('The page took too long to load')).toBeVisible();
      expect(screen.getByRole('button', {name: 'Try again'})).toBeVisible();
    });

    it('reports a failed POLL instead of spinning forever', async () => {
      server(() => jsonResponse(500, {error: 'Internal server error'}));
      renderShare();

      expect(await screen.findByText('Internal server error')).toBeVisible();
      expect(statusLine()).not.toHaveTextContent(/Fetching the page|Requesting the audit/);
    });

    it('retries a failed poll by ASKING AGAIN, not by auditing again', async () => {
      const fetchMock = server(() => jsonResponse(500, {error: 'Internal server error'}));
      renderShare();
      await screen.findByRole('button', {name: 'Try again'});
      const postsBefore = fetchMock.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
      ).length;

      await userEvent.click(screen.getByRole('button', {name: 'Try again'}));

      await waitFor(() => {
        const gets = fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method !== 'POST');
        expect(gets.length).toBeGreaterThan(1);
      });
      const postsAfter = fetchMock.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
      ).length;
      expect(postsAfter).toBe(postsBefore);
    });

    it('shows progress again WHILE a poll retry is in flight', async () => {
      let release = (): void => undefined;
      let failing = true;
      const held = async (): Promise<Response> => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return jsonResponse(200, auditBody({status: 'running'}));
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) => {
          if (init?.method === 'POST') {
            return jsonResponse(202, {auditId: 'abc', status: 'queued', pollAfterMs: 20});
          }
          if (failing) {
            return jsonResponse(500, {error: 'Internal server error'});
          }
          return await held();
        }),
      );

      renderShare();
      await screen.findByRole('button', {name: 'Try again'});

      failing = false;
      await userEvent.click(screen.getByRole('button', {name: 'Try again'}));

      await waitFor(() => {
        expect(statusLine()).toHaveTextContent(/Looking for that audit/);
      });
      expect(screen.queryByText('Internal server error')).not.toBeInTheDocument();
      release();
    });

    it('reports a poll that fails AFTER an earlier one succeeded', async () => {
      let gets = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init?: RequestInit) => {
          if (init?.method === 'POST') {
            return Promise.resolve(jsonResponse(202, {auditId: 'abc', status: 'queued', pollAfterMs: 20}));
          }
          gets += 1;
          return Promise.resolve(
            gets === 1
              ? jsonResponse(200, auditBody({status: 'running'}))
              : jsonResponse(500, {error: 'Internal server error'}),
          );
        }),
      );

      renderShare();

      expect(await screen.findByText('Internal server error')).toBeVisible();
      expect(screen.getByRole('button', {name: 'Try again'})).toBeVisible();
    });

    it('interrupts completion with failure and restores progress on retry', async () => {
      let gets = 0;
      let release = (): void => undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) => {
          if (init?.method === 'POST') {
            return jsonResponse(202, {auditId: 'abc', status: 'queued', pollAfterMs: 20});
          }
          gets += 1;
          if (gets === 1) {
            return jsonResponse(200, auditBody({status: 'running'}));
          }
          if (gets === 2) {
            return jsonResponse(500, {error: 'Internal server error'});
          }
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return jsonResponse(200, auditBody({status: 'running'}));
        }),
      );

      renderShare();
      expect(await screen.findByText('Internal server error')).toBeVisible();
      expect(document.querySelector('.report-page')).toHaveAttribute('data-view', 'failure');
      expect(document.querySelector('.audit-progress')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', {name: 'Try again'}));

      expect(screen.queryByText('Internal server error')).not.toBeInTheDocument();
      await waitFor(() => {
        expect(statusLine()).toHaveTextContent(/about 30 seconds/);
      });
      expect(document.querySelector('.report-page')).toHaveAttribute('data-view', 'progress');
      expect(document.querySelector('.audit-progress')).toBeVisible();
      expect(screen.queryByText('Internal server error')).not.toBeInTheDocument();
      release();
    });

    it('restores progress when retrying from a post-success poll failure', async () => {
      let gets = 0;
      let recovered = false;
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init?: RequestInit) => {
          if (init?.method === 'POST') {
            return Promise.resolve(jsonResponse(202, {auditId: 'abc', status: 'queued', pollAfterMs: 20}));
          }
          gets += 1;
          if (gets === 1) {
            return Promise.resolve(jsonResponse(200, auditBody({status: 'running'})));
          }
          return Promise.resolve(
            recovered
              ? jsonResponse(200, auditBody({status: 'running'}))
              : jsonResponse(500, {error: 'Internal server error'}),
          );
        }),
      );

      renderShare();
      await screen.findByText('Internal server error');

      recovered = true;
      await userEvent.click(screen.getByRole('button', {name: 'Try again'}));

      await waitFor(() => {
        expect(statusLine()).toHaveTextContent(/Fetching the page/);
      });
      expect(screen.queryByText('Internal server error')).not.toBeInTheDocument();
    });

    it('stops polling once it has given up, rather than retrying behind the message', async () => {
      vi.useFakeTimers({shouldAdvanceTime: true});
      const fetchMock = server(
        () => jsonResponse(200, auditBody({status: 'running', score: null, completedAt: null, violations: []})),
        () => jsonResponse(500, {error: 'Internal server error'}),
      );

      renderShare();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FALLBACK_POLL_AFTER_MS + 500);
      });
      await screen.findByText('Internal server error');

      const settled = fetchMock.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(fetchMock).toHaveBeenCalledTimes(settled);
    });

    it('never shows a result alongside a failure', async () => {
      server(() => jsonResponse(200, auditBody({status: 'failed', error: 'boom'})));
      renderShare();

      await screen.findByText('boom');
      expect(screen.queryByRole('heading', {name: /Result for/})).not.toBeInTheDocument();
    });

    it('never renders report header or either CTA while progress or failure is primary', async () => {
      let answer = (_response: Response): void => undefined;
      const held = new Promise<Response>((resolve) => {
        answer = resolve;
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(() => held),
      );
      renderShare();

      expect(screen.getByRole('heading', {name: 'Audit in progress'})).toBeInTheDocument();
      expect(screen.queryByRole('heading', {name: 'Accessibility report'})).not.toBeInTheDocument();
      expect(screen.queryByRole('button', {name: 'Copy link'})).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', {name: 'Keep an eye on this page'})).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', {name: 'Check your own site'})).not.toBeInTheDocument();

      answer(jsonResponse(500, {error: 'Internal server error'}));
      expect(await screen.findByText('Internal server error')).toBeVisible();
      expect(screen.queryByRole('heading', {name: 'Accessibility report'})).not.toBeInTheDocument();
      expect(screen.queryByRole('button', {name: 'Copy link'})).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', {name: 'Keep an eye on this page'})).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', {name: 'Check your own site'})).not.toBeInTheDocument();
    });

    it('offers the finished audit as a link to send to someone', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});
      renderShare();
      await screen.findByRole('heading', {level: 2, name: /Result for/});

      await userEvent.click(screen.getByRole('button', {name: 'Copy link'}));

      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/r/${UUID}`);
    });
  });

  describe('someone who has never seen tabstop', () => {
    it('is told what this is, in the heading and one line under it', async () => {
      renderShare();
      await result();

      expect(screen.getByRole('heading', {level: 1})).toBeVisible();
      expect(screen.getByText(/tabstop/)).toBeVisible();
    });

    it('closes with the same question about a page of their own', async () => {
      renderShare();
      await result();

      expect(screen.getByRole('heading', {name: 'Check your own site'})).toBeVisible();
      expect(screen.getByLabelText('Page to audit')).toBeVisible();
    });

    it('audits the address they type and takes them to its own page', async () => {
      server(
        () => jsonResponse(200, auditBody()),
        () => jsonResponse(202, {auditId: 'new-1', status: 'queued', pollAfterMs: 20}),
      );
      const router = renderShare();

      await userEvent.type(await screen.findByLabelText('Page to audit'), 'example.org{Enter}');

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/r/new-1');
      });
      expect(router.state.location.state).toEqual({startedHere: true, pollAfterMs: 20});
    });
  });
});
