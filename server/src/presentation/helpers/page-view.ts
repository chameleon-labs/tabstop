import type {LatestPageAudit, PageSummary as PageSummaryResponse, PageView} from '@tabstop/contract';
import type {AuditModel, AuditStatus} from '../../domain/models/audit.js';
import type {CountsByImpact} from '../../domain/models/impact.js';
import type {PageSummary as DomainPageSummary, PageModel} from '../../domain/models/page.js';
import type {PageHistory} from '../../domain/usecases/load-page-history.js';

/**
 * The page wire shapes live in `@tabstop/contract`, so the dashboard (#20) and
 * these mappers cannot drift apart. What stays here is the mapping itself,
 * which is a security boundary: `PageModel` carries `siteId` and `AuditModel`
 * carries its primary key, and both are built field by field rather than
 * spread precisely so a later `select *` cannot put either on the wire.
 */
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

export const toPageSummaryView = (summary: DomainPageSummary): PageSummaryResponse => ({
  ...toPageView(summary.page),
  domain: summary.domain,
  latestAudit: summary.latestAudit === null ? null : toLatestAuditView(summary.latestAudit),
  // History is oldest first, so the two most recent scores are at the end.
  score: summary.history.at(-1)?.score ?? null,
  previousScore: summary.history.at(-2)?.score ?? null,
  history: summary.history.map((point) => ({score: point.score, at: point.at.toISOString()})),
});

/**
 * One point on the trend chart (#21).
 *
 * `axeVersion` rides along per point so the chart can mark where the engine
 * changed. A score shift across an axe upgrade is not a regression in the
 * page, and without this the chart raises a false alarm the first time axe is
 * bumped - which is the sort of thing that teaches a team to ignore it.
 */
export type PageHistoryPointView = {
  /** The public uuid, so a point can link to its own result (#23). */
  auditId: string;
  createdAt: string;
  status: AuditStatus;
  /** Null whenever the run did not finish. Never coerced to zero. */
  score: number | null;
  countsByImpact: CountsByImpact;
  axeVersion: string | null;
};

export type PageHistoryView = {
  pageId: string;
  url: string;
  /** What the server actually used, which is not always what was asked for. */
  days: number;
  points: PageHistoryPointView[];
};

export const toPageHistoryView = (history: PageHistory, days: number): PageHistoryView => ({
  pageId: history.page.id,
  url: history.page.url,
  days,
  points: history.audits.map((audit) => ({
    auditId: audit.publicUuid,
    createdAt: audit.createdAt.toISOString(),
    status: audit.status,
    // A failed run is a point with no score, not a zero and not a missing
    // entry. Both alternatives lie about what happened.
    score: audit.score,
    countsByImpact: audit.countsByImpact,
    axeVersion: audit.axeVersion,
  })),
});
