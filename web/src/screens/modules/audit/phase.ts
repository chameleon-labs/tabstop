import type {AuditStatus} from '@tabstop/contract';

export type Phase = {
  readonly fromMs: number;
  readonly label: string;
};

export const PHASES: readonly Phase[] = [
  {fromMs: 0, label: 'Fetching the page'},
  {fromMs: 8_000, label: 'Running the accessibility engine'},
  {fromMs: 20_000, label: 'Scoring'},
];

export const EXPECTED_DURATION = 'this usually takes about 30 seconds';

const QUEUED_LABEL = 'Waiting for a free worker';
const SUBMITTING_LABEL = 'Requesting the audit';

export type ProgressStatus = AuditStatus | 'submitting';

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

  const phase = PHASES.findLast((candidate) => elapsedMs >= candidate.fromMs) ?? PHASES[0];
  return phase?.label ?? null;
};

export const announcementFor = (phase: string | null, announced: string | null): string | null =>
  phase === null || phase === announced ? null : `${phase}… ${EXPECTED_DURATION}`;

export const completionAnnouncement = (score: number | null, violationCount: number): string => {
  const found = violationCount === 1 ? '1 issue found' : `${violationCount} issues found`;
  return score === null ? `Audit complete. ${found}.` : `Audit complete. Score ${score}. ${found}.`;
};
