import type {AuditStatus, PageSummary} from '@tabstop/contract';

export type DashboardRowKind = 'paused' | 'failed' | 'first-audit' | 'reaudit' | 'scored' | 'unstarted';

export type DashboardRowState = {
  kind: DashboardRowKind;
  scoreLabel: 'Score' | 'Last successful score' | null;
  showScore: boolean;
  showDelta: boolean;
  showTrend: boolean;
  inFlightPrefix: 'First audit' | 'Re-audit' | null;
};

const inFlight = (status: AuditStatus | undefined): boolean => status === 'queued' || status === 'running';

export const dashboardRowState = (page: PageSummary): DashboardRowState => {
  const hasScore = page.score !== null;
  const hasHistory = page.history.length > 0;

  const retained = {
    scoreLabel: hasScore ? ('Last successful score' as const) : null,
    showScore: hasScore,
    showDelta: hasScore,
    showTrend: hasHistory,
  };

  if (!page.monitoringEnabled) {
    return {kind: 'paused', ...retained, inFlightPrefix: null};
  }

  if (page.latestAudit?.status === 'failed') {
    return {kind: 'failed', ...retained, inFlightPrefix: null};
  }

  // A scheduled audit is queued for hours before a worker may take it, so it
  // is not work in progress: treating it as such gives the row two reasons for
  // the same wait and leaves a one-second phase timer running through the whole
  // delay.
  const waitingOnSchedule = page.latestAudit?.status === 'queued' && page.nextAuditAt !== null;

  if (inFlight(page.latestAudit?.status) && !waitingOnSchedule) {
    return hasHistory
      ? {
          kind: 'reaudit',
          scoreLabel: 'Score',
          showScore: hasScore,
          showDelta: hasScore,
          showTrend: true,
          inFlightPrefix: 'Re-audit',
        }
      : {
          kind: 'first-audit',
          scoreLabel: null,
          showScore: false,
          showDelta: false,
          showTrend: false,
          inFlightPrefix: 'First audit',
        };
  }

  if (hasScore) {
    return {
      kind: 'scored',
      scoreLabel: 'Score',
      showScore: true,
      showDelta: true,
      showTrend: hasHistory,
      inFlightPrefix: null,
    };
  }

  return {
    kind: 'unstarted',
    scoreLabel: null,
    showScore: false,
    showDelta: false,
    showTrend: false,
    inFlightPrefix: null,
  };
};
