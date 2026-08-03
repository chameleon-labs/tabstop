import { useEffect, useState } from 'react'
import { phaseFor, type ProgressStatus } from '../audit/phase'

/** How often the phase is recomputed. Cheap, and unrelated to the poll interval. */
export const TICK_MS = 1_000

/**
 * The phase label for an audit in flight, ticking as time passes.
 *
 * A HOOK rather than state inside the progress indicator, because two things
 * need the same answer: the visible sentence, and the live region that has to
 * outlive that sentence to announce completion. Two clocks would drift, and the
 * region would eventually announce a phase the screen was no longer showing.
 *
 * THE CLOCK STARTS WHEN THE WORK STARTS, not when the request was sent, and it
 * is moved DURING RENDER rather than in an effect. `startedAt` includes however
 * long the job sat in a queue, and the phases describe what a worker is doing -
 * so a job that waited twenty seconds for a free worker would reach its first
 * `running` render already claiming to be "Scoring".
 *
 * Fixing that in an effect fixed it too late: the `running` render commits
 * first with the queued-time elapsed, so the region says "Scoring", and only
 * then does a second render say "Fetching the page". Two announcements, in
 * reverse order, on the one transition worth narrating. React's own
 * adjust-state-during-render pattern re-renders before anything is committed,
 * so the intermediate value never reaches the DOM at all.
 */
export const useAuditPhase = (
  status: ProgressStatus, startedAt: number | null
): string | null => {
  const [now, setNow] = useState(() => Date.now())
  const [runningSince, setRunningSince] = useState<number | null>(null)
  const [seenStatus, setSeenStatus] = useState(status)

  if (status !== seenStatus) {
    setSeenStatus(status)
    if (status === 'running' && runningSince === null) setRunningSince(Date.now())
  }

  // Falls back to `startedAt` when the transition was never observed - a reload
  // mid-audit, say. The same approximation as before, and the best available:
  // the response carries no worker-start timestamp.
  const since = runningSince ?? startedAt

  useEffect(() => {
    if (since === null) return
    const timer = setInterval(() => { setNow(Date.now()) }, TICK_MS)
    return () => { clearInterval(timer) }
  }, [since])

  if (since === null) return null

  // Computed during render, so it can never be a tick behind the epoch. A
  // freshly moved epoch with a stale `now` reads as slightly negative, which
  // `phaseFor` treats as the first phase - correct, and the only sane answer.
  return phaseFor(status, now - since)
}
