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

/**
 * One classifier, so the row's markup, its styling and its tests cannot each
 * invent their own precedence.
 */
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

  if (inFlight(page.latestAudit?.status)) {
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
