import type {AuditStatus} from '@tabstop/contract';

/**
 * What to say during the thirty seconds an audit takes.
 *
 * A spinner for thirty seconds reads as broken; naming what is happening and
 * saying how long it takes help more than animation.
 *
 * THESE PHASES ARE AN APPROXIMATION AND THE CODE SHOULD SAY SO. The server
 * reports only `queued` and `running`, so the phase is inferred from elapsed
 * time - honest, since the work happens in this order, but still inference: a
 * slow page sits on "Scoring" while it is still loading. The fix is a `phase`
 * column on the audit row, not better guesses here.
 */
export type Phase = {
  /** Elapsed milliseconds at which this phase starts. */
  readonly fromMs: number;
  readonly label: string;
};

/**
 * Boundaries taken from the worker's own budgets. The last phase is the longest
 * deliberately: overrunning into "Scoring" looks like the end of a job, whereas
 * overrunning into "Fetching the page" looks like a stuck one.
 */
export const PHASES: readonly Phase[] = [
  {fromMs: 0, label: 'Fetching the page'},
  {fromMs: 8_000, label: 'Running the accessibility engine'},
  {fromMs: 20_000, label: 'Scoring'},
];

/** Said up front, so thirty seconds is an expectation rather than a surprise. */
export const EXPECTED_DURATION = 'this usually takes about 30 seconds';

const QUEUED_LABEL = 'Waiting for a free worker';
const SUBMITTING_LABEL = 'Requesting the audit';

/**
 * The audit's status, plus the moment before it has one.
 *
 * Between submitting and the server accepting, no audit and no queue entry
 * exists, so "Waiting for a free worker" would describe a queue the request has
 * not reached and may never reach.
 *
 * A status rather than a separate component, so the live region stays ONE
 * element across the whole wait: swapping elements replaces the region, and a
 * region's first content is initial content, which is announced by nothing.
 */
export type ProgressStatus = AuditStatus | 'submitting';

/**
 * The phase label for an audit, or null once there is nothing to announce.
 *
 * `queued` is its own label rather than the first phase: nothing is being
 * fetched yet, and saying otherwise is the kind of small lie that makes a
 * progress indicator untrustworthy.
 */
export const phaseFor = (status: ProgressStatus, elapsedMs: number): string | null => {
  if (status === 'submitting') {
    return SUBMITTING_LABEL;
  }
  if (status === 'queued') {
    return QUEUED_LABEL;
  }
  if (status !== 'running') {
    return null;
  }

  // Last match wins, so the array reads in the order the phases happen. The
  // first phase doubles as the fallback before its own threshold.
  const phase = PHASES.findLast((candidate) => elapsedMs >= candidate.fromMs) ?? PHASES[0];
  return phase?.label ?? null;
};

/**
 * What a live region should be told, given what it was told last.
 *
 * Null means "say nothing", which is the whole reason this exists: a polite
 * region re-read on every poll gives fifteen announcements for one audit, each
 * interrupting the last - exactly the defect this product exists to find.
 * Announcing only on CHANGE keeps it to three.
 */
export const announcementFor = (phase: string | null, announced: string | null): string | null =>
  phase === null || phase === announced ? null : `${phase}… ${EXPECTED_DURATION}`;

/**
 * What to announce when the audit lands.
 *
 * The result appears without the route changing, so nothing else says anything
 * and someone who waited thirty seconds gets no indication it arrived.
 *
 * Short, and NOT a summary of the findings: the result is on screen to be read,
 * and reciting it would talk over someone already reading it.
 */
export const completionAnnouncement = (score: number | null, violationCount: number): string => {
  const found = violationCount === 1 ? '1 issue found' : `${violationCount} issues found`;
  return score === null ? `Audit complete. ${found}.` : `Audit complete. Score ${score}. ${found}.`;
};
