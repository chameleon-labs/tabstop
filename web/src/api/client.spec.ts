import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ApiError, conflictOf, pageConflictOf, post, rateLimitOf, request} from './client';
import {jsonResponse} from '../test/http';

describe('the API client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, {ok: true})));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const lastInit = (): RequestInit => (fetchMock.mock.calls[0] as [string, RequestInit])[1];

  const sentHeaders = (): Headers => lastInit().headers as Headers;

  it('sends the session cookie on every request', async () => {
    await request('/api/me');

    expect(lastInit().credentials).toBe('include');
  });

  it('sends it on writes too, not only reads', async () => {
    await post('/api/audits', {url: 'https://example.com'});

    expect(lastInit().credentials).toBe('include');
    expect(lastInit().body).toBe('{"url":"https://example.com"}');
  });

  it('does not claim a content type on a request with no body', async () => {
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
      expect(rateLimitOf(new TypeError('Failed to fetch'))).toBeNull();
      expect(rateLimitOf(undefined)).toBeNull();
    });

    it.each([0, -5, 2.5])('rejects retryAfter %s, which cannot be a countdown', async (retryAfter) => {
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
      const error = await conflict({code: 'page_limit_reached', error: 'At your limit'});

      expect(pageConflictOf(error)).toBeNull();
    });

    it('refuses a code this build does not know', async () => {
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
