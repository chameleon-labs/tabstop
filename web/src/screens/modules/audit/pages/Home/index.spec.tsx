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

const statusLine = (): HTMLElement => {
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
    renderAt('/');

    expect(screen.getByRole('link', {name: 'Log in'})).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', {name: 'Sign up'})).toHaveAttribute('href', '/signup');
    expect(screen.getByRole('link', {name: 'Sign up'})).toHaveAttribute('data-variant', 'primary');
  });

  it('opens the score formula from the footer', async () => {
    renderAt('/');

    const scoreFormula = screen.getByRole('link', {name: 'Score formula'});
    expect(scoreFormula).toHaveAttribute('href', '/docs/score-formula');

    await userEvent.click(scoreFormula);

    expect(await screen.findByRole('heading', {level: 1, name: 'How the score is calculated'})).toBeVisible();
    await waitFor(() => {
      expect(document.title).toBe('Score formula · tabstop');
      expect(screen.getByRole('status')).toHaveTextContent('Score formula · tabstop');
    });
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

    await waitFor(() => {
      expect(statusLine()).toHaveTextContent(/Requesting the audit/);
    });
    expect(screen.getAllByText(/Requesting the audit/)).toHaveLength(1);
    expect(screen.queryByText(/Waiting for a free worker/)).not.toBeInTheDocument();
    await act(() => {
      release();
    });
  });

  it('keeps the sample report visible while the request is in flight', async () => {
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
        return jsonResponse(200, auditBody());
      }),
    );
    renderAt('/');

    await submit('example.com');

    await waitFor(() => {
      expect(screen.getByLabelText('Page to audit')).toBeDisabled();
    });
    expect(screen.getByText('https://acme.example')).toBeVisible();

    await act(() => {
      release();
    });
  });

  it('keeps request narration available without adding it to the visible landing layout', async () => {
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
        return jsonResponse(200, auditBody());
      }),
    );
    renderAt('/');

    await submit('example.com');

    await waitFor(() => {
      expect(statusLine()).toHaveTextContent('Requesting the audit');
    });
    expect(statusLine().parentElement).toHaveClass('visually-hidden');
    expect(screen.queryByRole('alert')).not.toHaveTextContent('Requesting the audit');

    await act(() => {
      release();
    });
  });

  describe('handing over to the audit page', () => {
    it('leaves for the audit as soon as the server accepts it', async () => {
      const {router} = renderAt('/');

      await submit('example.com');

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/r/abc');
      });
    });

    it("carries the server's poll interval, so it can still be widened without a deploy", async () => {
      server({post: () => jsonResponse(202, {auditId: 'abc', status: 'queued', pollAfterMs: 750})});
      const {router} = renderAt('/');

      await submit('example.com');

      await waitFor(() => {
        expect(router.state.location.state).toEqual({startedHere: true, pollAfterMs: 750});
      });
    });

    it("marks the audit as this visitor's own, which the report reads", async () => {
      const {router} = renderAt('/');

      await submit('example.com');

      await waitFor(() => {
        expect(router.state.location.state).toEqual({startedHere: true, pollAfterMs: 20});
      });
    });

    it('shows the report it handed over to', async () => {
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
