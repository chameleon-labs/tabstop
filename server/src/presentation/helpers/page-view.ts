import type {
  LatestPageAudit,
  PageHistoryResponse,
  PageSummary as PageSummaryResponse,
  PageView,
} from '@tabstop/contract';
import type {AuditModel} from '../../domain/models/audit.js';
import type {PageModel, ScheduledPageSummary} from '../../domain/models/page.js';
import type {PageHistory} from '../../domain/usecases/load-page-history.js';

export const toPageView = (page: PageModel): PageView => ({
  id: page.id,
  url: page.url,
  monitoringEnabled: page.monitoringEnabled,
  createdAt: page.createdAt.toISOString(),
});

const toLatestAuditView = (audit: AuditModel): LatestPageAudit => ({
  auditId: audit.publicUuid,
  status: audit.status,
  score: audit.score,
  countsByImpact: audit.countsByImpact,
  createdAt: audit.createdAt.toISOString(),
  completedAt: audit.completedAt?.toISOString() ?? null,
  error: audit.error,
});

export const toPageSummaryView = (summary: ScheduledPageSummary): PageSummaryResponse => ({
  ...toPageView(summary.page),
  domain: summary.domain,
  latestAudit: summary.latestAudit === null ? null : toLatestAuditView(summary.latestAudit),
  score: summary.history.at(-1)?.score ?? null,
  previousScore: summary.history.at(-2)?.score ?? null,
  history: summary.history.map((point) => ({score: point.score, at: point.at.toISOString()})),
  nextAuditAt: summary.nextAuditAt?.toISOString() ?? null,
});

export const toPageHistoryView = (history: PageHistory, days: number): PageHistoryResponse => ({
  pageId: history.page.id,
  url: history.page.url,
  days,
  points: history.audits.map((audit) => ({
    auditId: audit.publicUuid,
    createdAt: audit.createdAt.toISOString(),
    status: audit.status,
    score: audit.score,
    countsByImpact: audit.countsByImpact,
    axeVersion: audit.axeVersion,
  })),
});
