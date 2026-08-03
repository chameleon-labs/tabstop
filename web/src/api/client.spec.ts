import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, conflictOf, post, rateLimitOf, request } from './client'
import { jsonResponse } from '../test/http'

describe('the API client', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => { vi.unstubAllGlobals() })

  const lastInit = (): RequestInit => (fetchMock.mock.calls[0] as [string, RequestInit])[1]

  it('sends the session cookie on every request', async () => {
    // Omit this and a valid session returns 401 on every authenticated call,
    // looking exactly like a backend bug. It is not per-endpoint opt-in for
    // that reason: there is one place to get it right.
    await request('/api/me')

    expect(lastInit().credentials).toBe('include')
  })

  it('sends it on writes too, not only reads', async () => {
    await post('/api/audits', { url: 'https://example.com' })

    expect(lastInit().credentials).toBe('include')
    expect(lastInit().body).toBe('{"url":"https://example.com"}')
  })

  it('does not claim a content type on a request with no body', async () => {
    // A GET with `content-type: application/json` and nothing to describe is
    // the kind of header that quietly turns a simple request into a preflight.
    await request('/api/me')

    expect(lastInit().headers).not.toHaveProperty('content-type')
  })

  it('raises the server sentence, not the status code', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'A url is required' }))

    await expect(request('/api/audits')).rejects.toThrow('A url is required')
  })

  it('carries the status so a caller can branch without parsing the message', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'Audit not found' }))

    const error = await request('/api/audits/x').catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(404)
  })

  it('survives a response that is not JSON at all', async () => {
    // A 502 from a proxy is an HTML page. Parsing it must fail as the status it
    // is, rather than as a SyntaxError from somewhere inside the client.
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', {
      status: 502, statusText: 'Bad Gateway', headers: { 'content-type': 'text/html' }
    }))

    const error = await request('/api/me').catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(502)
    expect((error as ApiError).message).toBe('Bad Gateway')
  })

  it('survives a JSON content type with a truncated body', async () => {
    fetchMock.mockResolvedValue(new Response('{"error": "half', {
      status: 500, statusText: 'Internal Server Error',
      headers: { 'content-type': 'application/json' }
    }))

    await expect(request('/api/me')).rejects.toThrow('Internal Server Error')
  })

  it('returns null for a 204 rather than trying to parse it', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(request('/api/pages/1')).resolves.toBeNull()
  })

  describe('rate limiting', () => {
    it('reports the wait a 429 came with', async () => {
      const resetAt = '2026-08-02T10:00:00.000Z'
      fetchMock.mockResolvedValue(jsonResponse(429, {
        error: 'Too many requests', retryAfter: 30, resetAt
      }))

      const error = await request('/api/audits').catch((thrown: unknown) => thrown)

      expect(rateLimitOf(error)).toEqual({
        error: 'Too many requests', retryAfter: 30, resetAt
      })
    })

    it('rejects a 429 whose fields are the wrong types', async () => {
      // The reason error bodies are checked at runtime and success bodies are
      // not: a screen renders `resetAt` as a countdown. A string where a number
      // belongs, from a proxy or a limiter that fell over, produces
      // "Invalid Date" rather than an error anyone can act on. Null here means
      // the caller falls back to displaying the message, which is always safe.
      fetchMock.mockResolvedValue(jsonResponse(429, {
        error: 'Too many requests', retryAfter: '30', resetAt: 12345
      }))

      const error = await request('/api/audits').catch((thrown: unknown) => thrown)

      expect(rateLimitOf(error)).toBeNull()
      expect((error as ApiError).message).toBe('Too many requests')
    })

    it('is not confused by another status that happens to carry the fields', async () => {
      fetchMock.mockResolvedValue(jsonResponse(400, {
        error: 'Nope', retryAfter: 30, resetAt: '2026-08-02T10:00:00.000Z'
      }))

      const error = await request('/api/audits').catch((thrown: unknown) => thrown)

      expect(rateLimitOf(error)).toBeNull()
    })
  })

  describe('coded conflicts', () => {
    it('surfaces the code so a 409 can choose a screen', async () => {
      fetchMock.mockResolvedValue(jsonResponse(409, {
        code: 'page_limit_reached', error: 'You are tracking ten pages', limit: 10
      }))

      const error = await request('/api/pages').catch((thrown: unknown) => thrown)

      expect(conflictOf(error)).toEqual({
        code: 'page_limit_reached', error: 'You are tracking ten pages'
      })
    })

    it('returns null for a plain 409, which is only ever displayed', async () => {
      fetchMock.mockResolvedValue(jsonResponse(409, { error: 'Already exists' }))

      const error = await request('/api/pages').catch((thrown: unknown) => thrown)

      expect(conflictOf(error)).toBeNull()
      expect((error as ApiError).message).toBe('Already exists')
    })
  })
})
