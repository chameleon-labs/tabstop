import type { AuditStatus } from '@tabstop/contract'
import { useEffect, useState } from 'react'
import { EXPECTED_DURATION, phaseFor } from '../../audit/phase'

export type AuditProgressProps = {
  status: AuditStatus
  /** When the audit was requested, for deriving the phase. */
  startedAt: number
}

/** How often the phase is recomputed. Cheap, and unrelated to the poll interval. */
const TICK_MS = 1_000

/**
 * What a person sees for the thirty seconds an audit takes.
 *
 * Two things do more than any animation: naming what is happening, and saying
 * how long it takes. Both are here, and the duration sits in the same sentence
 * as the phase - mentioned once at the top, it is gone by the time anyone
 * starts wondering.
 *
 * THE VISIBLE TEXT IS THE LIVE REGION, which is a deliberate simplification of
 * the obvious design. A separate hidden region duplicates the sentence, so a
 * screen reader meets it twice: once by navigating to the paragraph, once by
 * announcement. One element cannot disagree with itself.
 *
 * It does not spam, and the reason is worth stating because it looks like it
 * should. This re-renders every second, but the rendered string is
 * `phase… duration` and the phase changes three times - React does not touch
 * the DOM when a text node's value is unchanged, so the region mutates three
 * times and announces three times. That is load-bearing rather than incidental:
 * putting anything per-tick in this sentence, an elapsed counter say, would
 * turn it into thirty announcements. A spec asserts it on MutationObserver
 * output, because the rendered text looks identical either way.
 *
 * `aria-live="polite"`, not `assertive`: this is progress, not an alert, and it
 * must wait its turn rather than cutting off whatever is being read.
 */
export const AuditProgress = ({ status, startedAt }: AuditProgressProps): React.JSX.Element | null => {
  const [now, setNow] = useState(() => Date.now())

  /**
   * The phase clock starts when the WORK starts, not when the request was sent,
   * and it is moved DURING RENDER rather than in an effect.
   *
   * `startedAt` includes however long the job sat in the queue, and the phases
   * describe what a worker is doing - so a job that waited twenty seconds for a
   * free worker would reach its first `running` render already claiming to be
   * "Scoring".
   *
   * Fixing that in an effect fixed it too late. The `running` render commits
   * first, with the queued-time elapsed still in hand, so the live region says
   * "Scoring"; the effect then resets the epoch and a second render says
   * "Fetching the page". Two announcements, in reverse order, on the one
   * transition this component exists to narrate. React's own
   * adjust-state-during-render pattern re-renders before anything is committed,
   * so the intermediate value never reaches the DOM at all.
   *
   * Null until the transition is observed. A reload mid-audit loses it and
   * falls back to `startedAt` - the same approximation as before, and the best
   * available, since the response carries no worker-start timestamp.
   */
  const [runningSince, setRunningSince] = useState<number | null>(null)
  const [seenStatus, setSeenStatus] = useState(status)

  if (status !== seenStatus) {
    setSeenStatus(status)
    if (status === 'running' && runningSince === null) setRunningSince(Date.now())
  }

  const since = runningSince ?? startedAt

  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, TICK_MS)
    return () => { clearInterval(timer) }
  }, [])

  // Computed during render, so it can never be a tick behind the epoch. A
  // freshly moved epoch with a stale `now` reads as slightly negative, which
  // `phaseFor` treats as the first phase - correct, and the only sane answer.
  const phase = phaseFor(status, now - since)
  if (phase === null) return null

  return (
    <section aria-labelledby="audit-progress-heading">
      <h2 id="audit-progress-heading">Auditing</h2>
      <p role="status" aria-live="polite" aria-atomic="true">
        {phase}… {EXPECTED_DURATION}
      </p>
    </section>
  )
}
