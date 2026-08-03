import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditProgress } from '.'

const START = 1_700_000_000_000

/**
 * Fake timers move `Date.now()` as well as the interval, so advancing the clock
 * advances the component's own notion of elapsed time. That matters: an
 * injected, FROZEN clock made the anti-spam assertion below vacuous - the text
 * could not change under any mutation, so the test passed against a component
 * that rewrote the region every tick.
 */
describe('AuditProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(START)
  })

  afterEach(() => { vi.useRealTimers() })

  const advance = async (ms: number): Promise<void> => {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }

  it('says the job is queued rather than claiming to fetch', () => {
    render(<AuditProgress status="queued" startedAt={START} />)

    expect(screen.getByText(/Waiting for a free worker/)).toBeVisible()
  })

  it('sets the expectation, because thirty seconds is a long time', () => {
    render(<AuditProgress status="running" startedAt={START} />)

    expect(screen.getByText(/this usually takes about 30 seconds/)).toBeVisible()
  })

  it('moves through the phases as time actually passes', async () => {
    render(<AuditProgress status="running" startedAt={START} />)
    expect(screen.getByText(/Fetching the page/)).toBeVisible()

    await advance(9_000)
    expect(screen.getByText(/Running the accessibility engine/)).toBeVisible()

    await advance(12_000)
    expect(screen.getByText(/Scoring/)).toBeVisible()
  })

  it('does not count queued time against the phases', async () => {
    // The bug: `startedAt` is when the POST was sent, and the phases describe
    // what a WORKER is doing. A job that waited twenty seconds for a free
    // worker reached its first `running` render already claiming to be
    // "Scoring", while the worker had only just begun fetching - the progress
    // indicator's first honest moment spent on its least honest statement.
    const { rerender } = render(<AuditProgress status="queued" startedAt={START} />)
    expect(screen.getByText(/Waiting for a free worker/)).toBeVisible()

    await advance(25_000)
    rerender(<AuditProgress status="running" startedAt={START} />)

    expect(screen.getByText(/Fetching the page/)).toBeVisible()
    expect(screen.queryByText(/Scoring/)).not.toBeInTheDocument()
  })

  it('runs the phases from when the work started, not from the request', async () => {
    const { rerender } = render(<AuditProgress status="queued" startedAt={START} />)
    await advance(25_000)
    rerender(<AuditProgress status="running" startedAt={START} />)

    await advance(9_000)

    expect(screen.getByText(/Running the accessibility engine/)).toBeVisible()
  })

  it('renders nothing once the audit is over', () => {
    const { container } = render(<AuditProgress status="done" startedAt={START} />)

    expect(container).toBeEmptyDOMElement()
  })

  describe('the live region', () => {
    const region = (): HTMLElement => screen.getByRole('status')

    const recordMutations = (): { seen: string[], stop: () => void } => {
      const seen: string[] = []
      const observer = new MutationObserver(() => { seen.push(region().textContent ?? '') })
      observer.observe(region(), { childList: true, characterData: true, subtree: true })
      return { seen, stop: () => { observer.disconnect() } }
    }

    it('is polite, so it waits its turn instead of cutting in', () => {
      render(<AuditProgress status="running" startedAt={START} />)

      expect(region()).toHaveAttribute('aria-live', 'polite')
    })

    it('does NOT change while the phase holds, across many ticks', async () => {
      // The failure this component exists to avoid. It re-renders once a second
      // for thirty seconds; a region whose text changes each time announces
      // thirty times, each interrupting the last. Unusable - and precisely the
      // defect this product finds on other people's sites.
      //
      // Asserted on DOM MUTATIONS, because the rendered text looks the same
      // whether or not the bug is present. Seven seconds of ticks, all inside
      // the first phase: nothing new to say, so nothing should move.
      render(<AuditProgress status="running" startedAt={START} />)
      const { seen, stop } = recordMutations()

      await advance(7_000)
      stop()

      expect(seen).toEqual([])
    })

    it('changes exactly once per phase boundary', async () => {
      // The other half: silence is only correct if it still speaks when it
      // should.
      //
      // Advanced one boundary at a time rather than thirty seconds at once,
      // and that is an artefact of the environment rather than of the
      // component: `advanceTimersByTimeAsync(30_000)` fires all thirty interval
      // callbacks before React renders, so it coalesces them into a single
      // render at the final phase and the middle one never reaches the DOM. In
      // a browser the ticks are a second apart and each phase renders.
      render(<AuditProgress status="running" startedAt={START} />)
      const { seen, stop } = recordMutations()

      await advance(9_000)
      await advance(12_000)
      stop()

      expect(seen).toEqual([
        expect.stringContaining('Running the accessibility engine'),
        expect.stringContaining('Scoring')
      ])
    })

    it('IS the visible text, so a reader never meets the sentence twice', () => {
      // A separate hidden region duplicates the sentence: navigating to the
      // paragraph reads it once, the announcement reads it again. One element
      // cannot disagree with itself, nor drift from itself.
      render(<AuditProgress status="running" startedAt={START} />)

      expect(region()).toHaveTextContent(/this usually takes about 30 seconds/)
      expect(screen.getAllByText(/this usually takes about 30 seconds/)).toHaveLength(1)
    })
  })
})
