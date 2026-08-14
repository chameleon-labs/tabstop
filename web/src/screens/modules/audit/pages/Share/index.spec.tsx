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

/** Answers in order, then repeats the last one - a poll asks more than once. */
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

/**
 * `retry: false` by default, so a failure path does not wait out a backoff
 * schedule. The one test that is ABOUT the retry policy passes the real client
 * instead: asserting "asked once" against a client told not to retry would pass
 * whatever the app does.
 */
const renderShare = ({
  client = new QueryClient({defaultOptions: {queries: {retry: false}}}),
  owner = false,
}: {client?: QueryClient; owner?: boolean} = {}) => {
  const router = createMemoryRouter(
    [
      {path: '/', element: <h1>Home screen</h1>},
      {path: '/r/:uuid', element: <Share />},
    ],
    // Router state marks the visitor who asked for the audit. A pasted link is
    // a fresh navigation and carries none, which is how a reader is told apart.
    {initialEntries: [owner ? {pathname: `/r/${UUID}`, state: startedHere()} : `/r/${UUID}`]},
  );

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return router;
};

/**
 * The audit's own region, told apart from the copy confirmation beside it by
 * `aria-atomic` - the one this flow speaks through, and the only one that
 * re-reads itself whole.
 */
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
    // The uuid is the only credential. A request for identity here would make
    // the link useless to the person it was sent to.
    const fetchMock = server();
    renderShare();
    await result();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([`/api/audits/${UUID}`]);
  });

  it('renders no field the contract does not carry, even when the API grows one', async () => {
    // Access control here is the unguessable uuid and nothing else, so a
    // regression that leaked an owner would leak it to everyone holding a link.
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
      // The original failure stays mounted, so its button would otherwise sit
      // beside the rate-limit message and start another audit.
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
      // The rate limit is the likeliest answer here, and the owner would
      // otherwise press Try again and watch nothing happen.
      server(
        () => jsonResponse(200, auditBody({status: 'failed', score: null, error: 'The page took too long to load'})),
        () => jsonResponse(429, {error: 'Too many requests', retryAfter: 45, resetAt: '2026-08-13T10:00:00.000Z'}),
      );
      renderShare({owner: true});

      await userEvent.click(await screen.findByRole('button', {name: 'Try again'}));

      expect(await screen.findByRole('heading', {name: 'You have used your free audits'})).toBeVisible();
    });

    it('quotes the server and offers no retry, because there is nothing here to retry', async () => {
      // Re-running it would either do nothing or start a different audit under
      // a different link. The way forward is the field above.
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
      // The audit query exhausts its retries, the POST error stays null, and
      // nothing was left to notice: `waiting` held, so the progress indicator
      // spun indefinitely on an audit nobody was still asking about.
      server(() => jsonResponse(500, {error: 'Internal server error'}));
      renderShare();

      expect(await screen.findByText('Internal server error')).toBeVisible();
      expect(statusLine()).not.toHaveTextContent(/Fetching the page|Requesting the audit/);
    });

    it('retries a failed poll by ASKING AGAIN, not by auditing again', async () => {
      // Re-submitting would spend another thirty seconds of Chromium, and
      // another of the caller's rate limit, to answer a question already being
      // answered.
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
      // This pins a REACT QUERY behaviour rather than one of ours: it clears a
      // query's error when a refetch begins, where it keeps a mutation's until
      // the next settles. A guard was written here first and removed once no
      // mutation of it changed anything observable. If a future version starts
      // retaining query errors, this fails rather than quietly stranding a
      // "Try again" button on screen for the whole retry.
      //
      // The retry is HELD OPEN deliberately. A mocked refetch that resolves
      // immediately never leaves the intermediate state observable, and a first
      // version of this test passed for exactly that reason.
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

      // Still in flight: the error must already be gone, and something must
      // stand in its place. No phase is claimed, because no response has
      // ever arrived to infer one from.
      await waitFor(() => {
        expect(statusLine()).toHaveTextContent(/Looking for that audit/);
      });
      expect(screen.queryByText('Internal server error')).not.toBeInTheDocument();
      release();
    });

    it('reports a poll that fails AFTER an earlier one succeeded', async () => {
      // A different path through React Query than the initial-failure case, and
      // for a while the only one covered was the initial one. With data already
      // in the cache the library tolerates the first failure silently - the
      // query stays `success` with the previous body - and only demotes to
      // `error` after another. Both were measured; what matters is that the
      // screen ends up saying something rather than spinning.
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
      // The path that made the `isFetching` guard necessary, and the one two
      // earlier tests missed: both let the retry resolve immediately, so the
      // in-flight window was never observable. React Query clears a query's
      // error on refetch only when there is NO cached data; with a `running`
      // body retained from an earlier poll it survives, and the failure panel
      // and its own button sat there for the whole request.
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

      // Still in flight: the failure must already be gone, and the status line
      // back to describing the wait. Phase-independent, because which phase it
      // is depends on how long the audit has been going.
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
      // The other half of the same path: the retry must not leave the failure
      // and its own button on screen for the whole flight, which is the
      // "button did nothing" shape.
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
      // The screen said "Lost track of that audit" and offered a Try again
      // button while silently re-requesting several times a second, for as
      // long as the tab stayed open: `refetchInterval` read only the RETAINED
      // `data.status`, which stays `running` when a later fetch fails. A button
      // that claims to be the way to retry must be the way to retry.
      // On a fresh link the interval is the fallback two seconds, so the
      // clock is driven rather than waited out - a real 300ms sleep raced the
      // second poll and failed about one run in three.
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
      // The same affordance the share page has: every result is shareable, and
      // this is where the loop starts.
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
      // The conversion mechanism of the growth loop: they came to read about
      // someone else's page, and this is the only thing worth offering them.
      renderShare();
      await result();

      expect(screen.getByRole('heading', {name: 'Check your own site'})).toBeVisible();
      expect(screen.getByLabelText('Page to audit')).toBeVisible();
    });

    it('audits the address they type and takes them to its own page', async () => {
      // Not back to the landing to type it again: an accepted audit has an
      // address of its own from the moment the server answers.
      server(
        () => jsonResponse(200, auditBody()),
        () => jsonResponse(202, {auditId: 'new-1', status: 'queued', pollAfterMs: 20}),
      );
      const router = renderShare();

      await userEvent.type(await screen.findByLabelText('Page to audit'), 'example.org{Enter}');

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/r/new-1');
      });
      // Marked as theirs, so the page offers monitoring rather than the field
      // they just used.
      expect(router.state.location.state).toEqual({startedHere: true, pollAfterMs: 20});
    });
  });
});
