import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ApiError, conflictOf, pageConflictOf, post, rateLimitOf, request} from './client';
import {jsonResponse} from '../test/http';

describe('the API client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse(200, {ok: true}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const lastInit = (): RequestInit => (fetchMock.mock.calls[0] as [string, RequestInit])[1];

  /** `headers` is always a `Headers` now, so read it as one. */
  const sentHeaders = (): Headers => lastInit().headers as Headers;

  it('sends the session cookie on every request', async () => {
    // Omit this and a valid session returns 401 on every authenticated call,
    // looking exactly like a backend bug. It is not per-endpoint opt-in for
    // that reason: there is one place to get it right.
    await request('/api/me');

    expect(lastInit().credentials).toBe('include');
  });

  it('sends it on writes too, not only reads', async () => {
    await post('/api/audits', {url: 'https://example.com'});

    expect(lastInit().credentials).toBe('include');
    expect(lastInit().body).toBe('{"url":"https://example.com"}');
  });

  it('does not claim a content type on a request with no body', async () => {
    // A GET with `content-type: application/json` and nothing to describe is
    // the kind of header that quietly turns a simple request into a preflight.
    await request('/api/me');

    expect(sentHeaders().has('content-type')).toBe(false);
    expect(sentHeaders().get('accept')).toBe('application/json');
  });

  describe('caller-supplied headers', () => {
    it('keeps a plain record', async () => {
      await request('/api/me', {headers: {'x-trace': 'abc'}});

      expect(sentHeaders().get('x-trace')).toBe('abc');
      expect(sentHeaders().get('accept')).toBe('application/json');
    });

    it('keeps a Headers instance, which object spread silently discards', async () => {
      // `{ ...new Headers({ a: 'b' }) }` is `{}`. Spreading looked right and
      // dropped every header a caller passed this way without a word.
      await request('/api/me', {headers: new Headers({'x-trace': 'abc'})});

      expect(sentHeaders().get('x-trace')).toBe('abc');
    });

    it('keeps an array of pairs, which spread discards too', async () => {
      await request('/api/me', {headers: [['x-trace', 'abc']]});

      expect(sentHeaders().get('x-trace')).toBe('abc');
    });

    it('lets the caller override a default rather than silently losing', async () => {
      await post('/api/audits', {url: 'x'});
      fetchMock.mockClear();

      await request('/api/audits', {
        method: 'POST',
        body: 'raw',
        headers: {'content-type': 'text/plain'},
      });

      expect(sentHeaders().get('content-type')).toBe('text/plain');
    });
  });

  it('raises the server sentence, not the status code', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, {error: 'A url is required'}));

    await expect(request('/api/audits')).rejects.toThrow('A url is required');
  });

  it('carries the status so a caller can branch without parsing the message', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, {error: 'Audit not found'}));

    const error = await request('/api/audits/x').catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });

  it('survives a response that is not JSON at all', async () => {
    // A 502 from a proxy is an HTML page. Parsing it must fail as the status it
    // is, rather than as a SyntaxError from somewhere inside the client.
    fetchMock.mockResolvedValue(
      new Response('<html>bad gateway</html>', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: {'content-type': 'text/html'},
      }),
    );

    const error = await request('/api/me').catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).message).toBe('Bad Gateway');
  });

  it('survives a JSON content type with a truncated body', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error": "half', {
        status: 500,
        statusText: 'Internal Server Error',
        headers: {'content-type': 'application/json'},
      }),
    );

    await expect(request('/api/me')).rejects.toThrow('Internal Server Error');
  });

  it('returns null for a 204 rather than trying to parse it', async () => {
    fetchMock.mockResolvedValue(new Response(null, {status: 204}));

    await expect(request('/api/pages/1')).resolves.toBeNull();
  });

  it('falls back to the status text when the body carries an empty message', async () => {
    // An empty string is not a sentence to show anyone, and using it would put
    // a blank error on screen - which reads as the app being broken in a way
    // nobody can describe.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({error: ''}), {
        status: 400,
        statusText: 'Bad Request',
        headers: {'content-type': 'application/json'},
      }),
    );

    await expect(request('/api/audits')).rejects.toThrow('Bad Request');
  });

  it('names the status when there is no status text either', async () => {
    // HTTP/2 carries no reason phrase, so `statusText` is empty on every
    // response from a modern server behind a modern proxy. Falling through to
    // an empty message there would silently affect the common case, not a
    // corner one.
    fetchMock.mockResolvedValue(new Response(null, {status: 502, statusText: ''}));

    await expect(request('/api/me')).rejects.toThrow('Request failed (502)');
  });

  describe('rate limiting', () => {
    it('reports the wait a 429 came with', async () => {
      const resetAt = '2026-08-02T10:00:00.000Z';
      fetchMock.mockResolvedValue(
        jsonResponse(429, {
          error: 'Too many requests',
          retryAfter: 30,
          resetAt,
        }),
      );

      const error = await request('/api/audits').catch((thrown: unknown) => thrown);

      expect(rateLimitOf(error)).toEqual({
        error: 'Too many requests',
        retryAfter: 30,
        resetAt,
      });
    });

    it('rejects a 429 whose fields are the wrong types', async () => {
      // The reason error bodies are checked at runtime and success bodies are
      // not: a screen renders `resetAt` as a countdown. A string where a number
      // belongs, from a proxy or a limiter that fell over, produces
      // "Invalid Date" rather than an error anyone can act on. Null here means
      // the caller falls back to displaying the message, which is always safe.
      fetchMock.mockResolvedValue(
        jsonResponse(429, {
          error: 'Too many requests',
          retryAfter: '30',
          resetAt: 12345,
        }),
      );

      const error = await request('/api/audits').catch((thrown: unknown) => thrown);

      expect(rateLimitOf(error)).toBeNull();
      expect((error as ApiError).message).toBe('Too many requests');
    });

    it('is null for something that is not an ApiError at all', () => {
      // A `fetch` rejection - offline, DNS, connection refused - reaches a
      // caller through the same channel and must not be read as a rate limit.
      expect(rateLimitOf(new TypeError('Failed to fetch'))).toBeNull();
      expect(rateLimitOf(undefined)).toBeNull();
    });

    it.each([0, -5, 2.5])('rejects retryAfter %s, which cannot be a countdown', async (retryAfter) => {
      // The server sends `Math.max(1, Math.ceil(ms / 1000))`, so none of these
      // can come from it. Zero invites an immediate retry, a negative counts
      // up forever, and a fraction renders as "2.5 seconds".
      fetchMock.mockResolvedValue(
        jsonResponse(429, {
          error: 'Too many requests',
          retryAfter,
          resetAt: '2026-08-03T10:00:00.000Z',
        }),
      );

      const error = await request('/api/audits').catch((thrown: unknown) => thrown);

      expect(rateLimitOf(error)).toBeNull();
    });

    it('rejects a resetAt that is a string but not a date', async () => {
      // `new Date('soon')` is Invalid Date, and a countdown built on it renders
      // "NaN" at a person who only wanted to know when to try again.
      fetchMock.mockResolvedValue(
        jsonResponse(429, {
          error: 'Too many requests',
          retryAfter: 30,
          resetAt: 'soon',
        }),
      );

      const error = await request('/api/audits').catch((thrown: unknown) => thrown);

      expect(rateLimitOf(error)).toBeNull();
    });

    it('is not confused by another status that happens to carry the fields', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(400, {
          error: 'Nope',
          retryAfter: 30,
          resetAt: '2026-08-02T10:00:00.000Z',
        }),
      );

      const error = await request('/api/audits').catch((thrown: unknown) => thrown);

      expect(rateLimitOf(error)).toBeNull();
    });
  });

  describe('coded conflicts', () => {
    it('surfaces the code so a 409 can choose a screen', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(409, {
          code: 'page_limit_reached',
          error: 'You are tracking ten pages',
          limit: 10,
        }),
      );

      const error = await request('/api/pages').catch((thrown: unknown) => thrown);

      expect(conflictOf(error)).toEqual({
        code: 'page_limit_reached',
        error: 'You are tracking ten pages',
      });
    });

    it('is null for something that is not an ApiError at all', () => {
      expect(conflictOf(new TypeError('Failed to fetch'))).toBeNull();
      expect(conflictOf(null)).toBeNull();
    });

    it('returns null for a plain 409, which is only ever displayed', async () => {
      fetchMock.mockResolvedValue(jsonResponse(409, {error: 'Already exists'}));

      const error = await request('/api/pages').catch((thrown: unknown) => thrown);

      expect(conflictOf(error)).toBeNull();
      expect((error as ApiError).message).toBe('Already exists');
    });
  });

  describe('page conflicts, narrowed to the variant they are', () => {
    const conflict = async (body: unknown): Promise<unknown> => {
      fetchMock.mockResolvedValue(jsonResponse(409, body));
      return await request('/api/pages').catch((thrown: unknown) => thrown);
    };

    it('keeps the limit, which no other field carries', async () => {
      // The whole reason this exists beside `conflictOf`. A screen saying
      // "you are tracking 10 of 10 pages" has nowhere else to get the 10, and
      // hardcoding it duplicates a cap the server owns.
      const error = await conflict({
        code: 'page_limit_reached',
        error: 'You are tracking ten pages',
        limit: 10,
      });

      expect(pageConflictOf(error)).toEqual({
        code: 'page_limit_reached',
        error: 'You are tracking ten pages',
        limit: 10,
      });
    });

    it('narrows the duplicate case, which carries no extra data', async () => {
      const error = await conflict({
        code: 'page_already_tracked',
        error: 'You already track this page',
      });

      expect(pageConflictOf(error)).toEqual({
        code: 'page_already_tracked',
        error: 'You already track this page',
      });
    });

    it('refuses a limit case with no usable limit', async () => {
      // Returning the variant without its number would push the missing-value
      // decision into a component, which would then invent one.
      const error = await conflict({code: 'page_limit_reached', error: 'At your limit'});

      expect(pageConflictOf(error)).toBeNull();
    });

    it('refuses a code this build does not know', async () => {
      // Degrade to displaying the sentence the server sent, rather than
      // branching on a variant that cannot be filled in.
      const error = await conflict({code: 'some_future_code', error: 'Nope'});

      expect(pageConflictOf(error)).toBeNull();
      expect(conflictOf(error)).toEqual({code: 'some_future_code', error: 'Nope'});
    });

    it('is null for a status that is not a conflict', async () => {
      fetchMock.mockResolvedValue(jsonResponse(400, {code: 'page_limit_reached', limit: 10}));
      const error = await request('/api/pages').catch((thrown: unknown) => thrown);

      expect(pageConflictOf(error)).toBeNull();
    });
  });
});
