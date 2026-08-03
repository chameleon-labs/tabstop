import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FALLBACK_POLL_AFTER_MS, useAudit } from './audits'
import { jsonResponse } from '../test/http'
import type { AuditResultResponse } from '@tabstop/contract'

const audit = (status: AuditResultResponse['status']): AuditResultResponse => ({
  auditId: 'abc', url: 'https://example.com', status,
  createdAt: '2026-08-02T09:00:00.000Z', completedAt: null,
  score: null, countsByImpact: { minor: 0, moderate: 0, serious: 0, critical: 0 },
  axeVersion: null, settled: true, error: null, violations: []
})

const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
)

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
