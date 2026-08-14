import type {AuditResultResponse} from '@tabstop/contract';
import {act, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ANNOUNCE_DELAY_MS} from '@/a11y/announce';
import {jsonResponse} from '@/test/http';
import {renderAt} from '@/test/render';

const auditBody = (over: Partial<AuditResultResponse> = {}): AuditResultResponse => ({
  auditId: 'abc',
  url: 'https://example.com/',
  status: 'done',
  createdAt: '2026-08-03T09:00:00.000Z',
  completedAt: '2026-08-03T09:00:30.000Z',
  score: 72,
  countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 1},
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

/**
 * Routed by method, because this screen drives two endpoints in sequence and a
 * single canned response cannot express "accepted, then still running, then
 * done" - which is the only interesting shape this screen has.
 */
const server = (handlers: {post?: () => Response; get?: () => Response}): ReturnType<typeof vi.fn> => {
  const mock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/me') {
      return Promise.resolve(jsonResponse(401, {error: 'Unauthorized'}));
    }
    return Promise.resolve(
      init?.method === 'POST'
        ? (handlers.post?.() ?? jsonResponse(202, {auditId: 'abc', status: 'queued', pollAfterMs: 20}))
        : (handlers.get?.() ?? jsonResponse(200, auditBody())),
    );
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};

/**
 * The shell carries its own polite region for route announcements and appears
 * first in the document, so the audit's status line is the later one.
 */
const statusLine = (): HTMLElement => {
  // Filtered by `aria-atomic`, which is what separates the two regions that
  // narrate an audit - the shell's announcer and this screen's status line -
  // from the copy confirmation beside the result, which is neither.
  const regions = screen.getAllByRole('status').filter((region) => region.getAttribute('aria-atomic') === 'true');
  return regions[regions.length - 1] as HTMLElement;
};

const submit = async (raw: string): Promise<void> => {
  await userEvent.type(screen.getByLabelText('Page to audit'), `${raw}{Enter}`);
};

describe('the home screen', () => {
  beforeEach(() => {
    server({});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'clipboard', {value: undefined, configurable: true});
  });

  it('leads with what the product does', () => {
    renderAt('/');

    expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Accessibility monitoring');
  });

  it('is the site itself, so the tab says only the site name', () => {
    renderAt('/');

    expect(document.title).toBe('tabstop');
  });

  it('links the landing navigation to the working credential routes', () => {
    // Through the SHARED header now, which labels this "Log in" - the landing
    // no longer carries a nav of its own.
    renderAt('/');

    expect(screen.getByRole('link', {name: 'Log in'})).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', {name: 'Sign up'})).toHaveAttribute('href', '/signup');
    expect(screen.getByRole('link', {name: 'Sign up'})).toHaveAttribute('data-variant', 'primary');
  });

  it('submits the normalised URL, not the typed one', async () => {
    const fetchMock = server({});
    renderAt('/');

    await submit('example.com');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"url":"https://example.com/"}');
  });

  it('does not claim a queue place while the request is still in flight', async () => {
    // A slow POST announced "Waiting for a free worker" before anything had
    // been accepted - a queue the request had not reached, and might never.
    let release = (): void => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return jsonResponse(202, {auditId: 'abc', status: 'queued', pollAfterMs: 20});
        }
        return jsonResponse(200, auditBody({status: 'running'}));
      }),
    );
    renderAt('/');

    await submit('example.com');

    // Two matches by design: the visible sentence and the live region that
    // announces it. Both should say the same thing, and neither should claim a
    // queue place.
    await waitFor(() => {
      expect(statusLine()).toHaveTextContent(/Requesting the audit/);
    });
    expect(screen.getAllByText(/Requesting the audit/)).toHaveLength(1);
    expect(screen.queryByText(/Waiting for a free worker/)).not.toBeInTheDocument();
    // Releasing it navigates, so React updates: `act` or the console gate trips.
    await act(() => {
      release();
    });
  });

  describe('handing over to the audit page', () => {
    it('leaves for the audit as soon as the server accepts it', async () => {
      // An accepted audit is addressable from that moment, so this screen has
      // nothing left to show. One result view, at one address.
      const {router} = renderAt('/');

      await submit('example.com');

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/r/abc');
      });
    });

    it("marks the audit as this visitor's own, which the report reads", async () => {
      // The same page serves whoever they send the link to, and only the state
      // of this navigation tells the two apart.
      const {router} = renderAt('/');

      await submit('example.com');

      await waitFor(() => {
        expect(router.state.location.state).toEqual({startedHere: true});
      });
    });

    it('shows the report it handed over to', async () => {
      // End to end through the redirect: paste, wait, read the result.
      renderAt('/');

      await submit('example.com');

      expect(await screen.findByRole('heading', {level: 1, name: 'example.com'})).toBeVisible();
      expect(screen.getByText('72')).toBeVisible();
    });

    it('keeps the field out of use while the request is in flight', async () => {
      let release = (): void => undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return jsonResponse(202, {auditId: 'abc', status: 'queued', pollAfterMs: 20});
        }),
      );
      renderAt('/');

      await submit('example.com');

      await waitFor(() => {
        expect(screen.getByLabelText('Page to audit')).toBeDisabled();
      });
      await act(() => {
        release();
      });
    });
  });

  describe('failure states, each distinct', () => {
    it("sends a rejected address back to the URL, with the server's reason", async () => {
      server({post: () => jsonResponse(400, {error: "That address can't be audited"})});
      renderAt('/');

      await submit('192.168.0.1');

      expect(await screen.findByText("That address can't be audited")).toBeVisible();
      expect(screen.queryByRole('button', {name: 'Try again'})).not.toBeInTheDocument();
    });

    it('turns the rate limit into a signup offer rather than an error', async () => {
      server({
        post: () =>
          jsonResponse(429, {
            error: 'Too many requests',
            retryAfter: 45,
            resetAt: '2026-08-03T10:00:00.000Z',
          }),
      });
      renderAt('/');

      await submit('example.com');

      expect(await screen.findByRole('heading', {name: 'You have used your free audits'})).toBeVisible();

      // The link has to GO somewhere. It pointed at `/signup`, which was not a
      // route, so the most motivated visitor this product will ever see landed
      // on the 404 screen.
      await userEvent.click(screen.getByRole('link', {name: 'Create an account'}));
      expect(await screen.findByRole('heading', {level: 1, name: 'Create an account'})).toBeVisible();
      expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
    });

    it('re-runs the same URL on retry, without asking for it again', async () => {
      const fetchMock = server({
        post: () => jsonResponse(503, {error: 'Could not queue that audit, please try again'}),
      });
      renderAt('/');
      await submit('example.com');
      await screen.findByRole('button', {name: 'Try again'});

      await userEvent.click(screen.getByRole('button', {name: 'Try again'}));

      await waitFor(() => {
        const posts = fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'POST');
        expect(posts.length).toBeGreaterThan(1);
        expect((posts.at(-1)?.[1] as RequestInit | undefined)?.body).toBe('{"url":"https://example.com/"}');
      });
    });

    it('clears the progress line when the request fails after it appeared', async () => {
      // Reported from a browser: "That audit could not be started / Method Not
      // Allowed" with "Requesting the audit… this usually takes about 30
      // seconds" still underneath it.
      //
      // Every other failure spec misses this because they fail INSTANTLY.
      // `AuditStatus` defers its write by ANNOUNCE_DELAY_MS, so a failure that
      // arrives inside that window cancels the write and the line is empty for
      // the right reason rather than the intended one. A real request takes
      // longer than 100ms to fail, the sentence lands first, and nothing ever
      // takes it back down.
      // Slow enough that the progress line is on screen before the failure.
      const slowFetch = vi.fn(async (_url: string, init?: RequestInit) => {
        await new Promise((resolve) => {
          setTimeout(resolve, ANNOUNCE_DELAY_MS * 3);
        });
        return init?.method === 'POST'
          ? jsonResponse(405, {error: 'Method Not Allowed'})
          : jsonResponse(200, auditBody());
      });
      vi.stubGlobal('fetch', slowFetch);
      renderAt('/');

      await submit('example.com');
      await waitFor(() => {
        expect(statusLine()).toHaveTextContent(/Requesting the audit/);
      });

      expect(await screen.findByText('Method Not Allowed')).toBeVisible();
      await waitFor(() => {
        expect(statusLine()).toBeEmptyDOMElement();
      });
    });
  });

  describe('what a screen reader is told', () => {
    it('announces the wait, starting from a region that was already there', async () => {
      server({get: () => jsonResponse(200, auditBody({status: 'running'}))});
      renderAt('/');

      await submit('example.com');

      await waitFor(() => {
        expect(statusLine()).toHaveTextContent(/Fetching the page/);
      });
    });
  });

  it('is completable with the keyboard alone', async () => {
    // An accessibility product whose own hook needs a mouse is not shippable.
    renderAt('/');

    const field = screen.getByLabelText('Page to audit');
    for (let tabs = 0; tabs < 8 && document.activeElement !== field; tabs += 1) {
      await userEvent.tab();
    }
    expect(field).toHaveFocus();

    await userEvent.keyboard('example.com{Enter}');

    expect(await screen.findByRole('heading', {level: 2, name: /Result for/})).toBeVisible();
  });
});
