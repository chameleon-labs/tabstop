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
  /**
   * The phase clock starts when the WORK starts, not when the request was sent.
   *
   * `startedAt` includes however long the job sat in the queue, and the phases
   * describe what a worker is doing. A job that waited twenty seconds for a
   * free worker would otherwise reach its first `running` render already
   * claiming to be "Scoring", while the worker had only just begun fetching -
   * the progress indicator's first honest moment spent on its least honest
   * statement.
   *
   * Null until the transition is observed. A reload mid-audit loses it and
   * falls back to `startedAt`, which is the same approximation as before and
   * the best available: the response carries no worker-start timestamp.
   */
  const [runningSince, setRunningSince] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (status !== 'running') return
    setRunningSince((known) => known ?? Date.now())
  }, [status])

  const since = runningSince ?? startedAt

  useEffect(() => {
    setElapsed(Date.now() - since)
    const timer = setInterval(() => { setElapsed(Date.now() - since) }, TICK_MS)
    return () => { clearInterval(timer) }
  }, [since])

  const phase = phaseFor(status, elapsed)
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
