import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuditPhase } from './use-audit-phase'
import type { ProgressStatus } from '../audit/phase'

const START = 1_700_000_000_000

/**
 * Fake timers move `Date.now()` as well as the interval, so advancing the clock
 * advances the hook's own notion of elapsed time. That matters: an injected,
 * FROZEN clock once made an assertion here vacuous - the value could not change
 * under any mutation, so the test passed against the bug it was written for.
 */
describe('useAuditPhase', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(START)
  })

  afterEach(() => { vi.useRealTimers() })

  const advance = async (ms: number): Promise<void> => {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }

  const at = (status: ProgressStatus) =>
    renderHook(({ s }: { s: ProgressStatus }) => useAuditPhase(s, START), {
      initialProps: { s: status }
    })

  it('has nothing to say before anything was submitted', () => {
    const { result } = renderHook(() => useAuditPhase('submitting', null))

    expect(result.current).toBeNull()
  })

  it('does not claim a queue place while the request is in flight', () => {
    expect(at('submitting').result.current).toBe('Requesting the audit')
  })

  it('says a queued audit is queued rather than claiming to fetch', () => {
    expect(at('queued').result.current).toBe('Waiting for a free worker')
  })

  it('moves through the phases as time actually passes', async () => {
    const { result } = at('running')
    expect(result.current).toBe('Fetching the page')

    await advance(9_000)
    expect(result.current).toBe('Running the accessibility engine')

    await advance(12_000)
    expect(result.current).toBe('Scoring')
  })

  it('has nothing to say once the audit is over', () => {
    expect(at('done').result.current).toBeNull()
    expect(at('failed').result.current).toBeNull()
  })

  describe('the queue does not count against the phases', () => {
    it('starts at the first phase however long the queue was', async () => {
      // `startedAt` is when the POST was sent, and the phases describe what a
      // WORKER is doing. A job that waited twenty-five seconds reached its
      // first `running` render already claiming to be "Scoring".
      const { result, rerender } = at('queued')
      await advance(25_000)

      rerender({ s: 'running' })

      expect(result.current).toBe('Fetching the page')
    })

    it('runs the phases from when the work started', async () => {
      const { result, rerender } = at('queued')
      await advance(25_000)
      rerender({ s: 'running' })

      await advance(9_000)

      expect(result.current).toBe('Running the accessibility engine')
    })
  })
})
