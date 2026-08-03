import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FALLBACK_POLL_AFTER_MS, useAudit, useRequestAudit } from './audits'
import { ApiError, rateLimitOf } from './client'
import { jsonResponse } from '../test/http'
import { wrapper } from '../test/render'
import type { AuditResultResponse } from '@tabstop/contract'

const audit = (status: AuditResultResponse['status']): AuditResultResponse => ({
  auditId: 'abc', url: 'https://example.com', status,
  createdAt: '2026-08-02T09:00:00.000Z', completedAt: null,
  score: null, countsByImpact: { minor: 0, moderate: 0, serious: 0, critical: 0 },
  axeVersion: null, settled: true, error: null, violations: []
})

describe('useAudit', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchMock = vi.fn(async () => jsonResponse(200, audit('running')))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps polling while the audit is running', async () => {
    renderHook(() => useAudit('abc', { pollAfterMs: 1000 }), { wrapper })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })

    await vi.advanceTimersByTimeAsync(2500)

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
  })

  it('stops the moment the audit is done', async () => {
    // The whole reason the interval is a function of the response. A tab left
    // open on a finished audit must not keep asking about it forever, and no
    // component should have to remember to clear a timer to make that true.
    fetchMock.mockImplementation(async () => jsonResponse(200, audit('done')))
    renderHook(() => useAudit('abc', { pollAfterMs: 1000 }), { wrapper })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })

    await vi.advanceTimersByTimeAsync(10_000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops on failed too, which is terminal for the same reason', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, audit('failed')))
    renderHook(() => useAudit('abc', { pollAfterMs: 1000 }), { wrapper })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })

    await vi.advanceTimersByTimeAsync(10_000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('honours the server-chosen interval rather than one of its own', async () => {
    // `pollAfterMs` exists so the server can widen the interval without a
    // frontend deploy. A client that ignores it takes that lever away.
    renderHook(() => useAudit('abc', { pollAfterMs: 5000 }), { wrapper })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })

    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_AFTER_MS + 500)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('asks for nothing until there is an id to ask about', () => {
    renderHook(() => useAudit(undefined), { wrapper })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('useRequestAudit', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      jsonResponse(202, { auditId: 'abc', status: 'queued', pollAfterMs: 2000 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('posts the url and returns the server-chosen poll interval', async () => {
    // `pollAfterMs` is the whole reason this returns a body rather than an id:
    // it is what `useAudit` should then be given, so the server can widen the
    // interval without a frontend deploy.
    const { result } = renderHook(() => useRequestAudit(), { wrapper })

    result.current.mutate('https://example.com')

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(result.current.data).toEqual({ auditId: 'abc', status: 'queued', pollAfterMs: 2000 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/audits')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"url":"https://example.com"}')
    expect(init.credentials).toBe('include')
  })

  it('surfaces a 429 as a wait a screen can render, not as a bare failure', async () => {
    // Anonymous and per-IP rate limited, so a 429 here is an expected outcome
    // of the product's main hook rather than something to hide.
    const resetAt = '2026-08-02T10:00:00.000Z'
    fetchMock.mockImplementation(async () =>
      jsonResponse(429, { error: 'Too many requests', retryAfter: 45, resetAt }))

    const { result } = renderHook(() => useRequestAudit(), { wrapper })
    result.current.mutate('https://example.com')

    await waitFor(() => { expect(result.current.isError).toBe(true) })
    expect(rateLimitOf(result.current.error)).toEqual({
      error: 'Too many requests', retryAfter: 45, resetAt
    })
  })

  it('reports a rejected url with the server\'s own sentence', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(400, { error: 'That URL resolves to a private address' }))

    const { result } = renderHook(() => useRequestAudit(), { wrapper })
    result.current.mutate('http://192.168.0.1')

    await waitFor(() => { expect(result.current.isError).toBe(true) })
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('That URL resolves to a private address')
  })

  it('does not retry, because a second audit is a second thirty seconds of Chromium', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(503, { error: 'Could not queue that audit, please try again' }))

    const { result } = renderHook(() => useRequestAudit(), { wrapper })
    result.current.mutate('https://example.com')

    await waitFor(() => { expect(result.current.isError).toBe(true) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
