import type { AuditStatus } from '@tabstop/contract'

/**
 * What to say during the thirty seconds an audit takes.
 *
 * A spinner for thirty seconds reads as broken. Two things help far more than
 * animation: naming what is happening, and saying up front how long it takes.
 *
 * THESE PHASES ARE AN APPROXIMATION AND THE CODE SHOULD SAY SO. The server
 * reports `queued` and `running` and nothing finer, so the phase is inferred
 * from elapsed time. It is honest enough - the real work does happen in this
 * order - but it is inference, and a slow page will sit on "Scoring" while it
 * is still loading. If this screen carries the product, the fix is a `phase`
 * column on the audit row rather than better guesses here.
 */
export type Phase = {
  /** Elapsed milliseconds at which this phase starts. */
  readonly fromMs: number
  readonly label: string
}

/**
 * Boundaries chosen from the worker's own budgets rather than invented: it
 * allows a navigation budget, then a settle wait, then injects axe and scores.
 * The last phase is deliberately the longest, because overrunning into
 * "Scoring" reads better than overrunning into "Fetching the page" - one looks
 * like the end of a job, the other like a stuck one.
 */
export const PHASES: readonly Phase[] = [
  { fromMs: 0, label: 'Fetching the page' },
  { fromMs: 8_000, label: 'Running the accessibility engine' },
  { fromMs: 20_000, label: 'Scoring' }
]

/** Said up front, so thirty seconds is an expectation rather than a surprise. */
export const EXPECTED_DURATION = 'this usually takes about 30 seconds'

const QUEUED_LABEL = 'Waiting for a free worker'
const SUBMITTING_LABEL = 'Requesting the audit'

/**
 * The audit's status, plus the moment before it has one.
 *
 * Between submitting and the server accepting, no audit and no queue entry
 * exists - so claiming "Waiting for a free worker" is not a rounding error, it
 * describes a queue the request has not reached and may never reach. A slow or
 * refused POST announced a phase that was never true.
 *
 * Carried as a status rather than as a separate component so the live region
 * stays ONE element across the whole wait: swapping elements would replace the
 * region, and a region's first content is initial content, which is announced
 * by nothing.
 */
export type ProgressStatus = AuditStatus | 'submitting'

/**
 * The phase label for an audit, or null once there is nothing to announce.
 *
 * `queued` is its own label rather than the first phase, because it is true and
 * different: nothing is being fetched yet. Saying "Fetching the page" while the
 * job sits in a queue is the kind of small lie that makes a progress indicator
 * untrustworthy.
 */
export const phaseFor = (status: ProgressStatus, elapsedMs: number): string | null => {
  if (status === 'submitting') return SUBMITTING_LABEL
  if (status === 'queued') return QUEUED_LABEL
  if (status !== 'running') return null

  // Last match wins, so the array reads in the order the phases happen.
  let label = PHASES[0]?.label ?? null
  for (const phase of PHASES) {
    if (elapsedMs >= phase.fromMs) label = phase.label
  }
  return label
}

/**
 * What a live region should be told, given what it was told last.
 *
 * Null means "say nothing", and that is the whole reason this exists. A polite
 * live region re-read on every poll is unusable - fifteen announcements for one
 * audit, each interrupting the last - and it is exactly the kind of defect this
 * product exists to find in other people's sites. Announcing only on CHANGE is
 * what keeps it to three.
 */
export const announcementFor = (phase: string | null, announced: string | null): string | null =>
  phase === null || phase === announced ? null : `${phase}… ${EXPECTED_DURATION}`

/**
 * What to announce when the audit lands.
 *
 * The result appears without the route changing, so nothing else says anything:
 * the progress region used to unmount at exactly this moment, and the route
 * announcer only speaks on navigation. Someone who waited thirty seconds for an
 * answer was given no indication it had arrived.
 *
 * Deliberately short, and deliberately NOT a summary of the findings. It says
 * the wait is over and roughly what was found; the result itself is on screen
 * to be read, and reciting it into a live region would talk over someone who
 * has already started reading.
 */
export const completionAnnouncement = (
  score: number | null, violationCount: number
): string => {
  const found = violationCount === 1 ? '1 issue found' : `${violationCount} issues found`
  return score === null
    ? `Audit complete. ${found}.`
    : `Audit complete. Score ${score}. ${found}.`
}
