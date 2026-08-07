import type {AuditModel, AuditStatus} from '../../domain/models/audit.js';
import type {CountsByImpact} from '../../domain/models/impact.js';
import type {PageSummary, PageModel} from '../../domain/models/page.js';
import type {PageHistory} from '../../domain/usecases/load-page-history.js';

/**
 * A page as the API reports it.
 *
 * Built field by field rather than spread from the model, because `PageModel`
 * carries `siteId` - an identifier for a grouping that belongs to the account,
 * which the client has no use for and which a later `select *` would happily
 * put on the wire.
 */
export type PageView = {
  id: string;
  url: string;
  monitoringEnabled: boolean;
  createdAt: string;
};

export const toPageView = (page: PageModel): PageView => ({
  id: page.id,
  url: page.url,
  monitoringEnabled: page.monitoringEnabled,
  createdAt: page.createdAt.toISOString(),
});

/**
 * The last run, whatever became of it - `queued` and `running` included, since
 * the dashboard shows work in progress.
 *
 * Null means there is no audit row at all, which after #11 is close to
 * unreachable: adding a page writes its first audit in the same transaction.
 * It is NOT "no audit has finished yet" - a page added a second ago reports a
 * `queued` audit here, so a consumer must not read null as "still waiting".
 */
export type LatestAuditView = {
  /** The public uuid, never the internal id. */
  auditId: string;
  status: AuditStatus;
  score: number | null;
  countsByImpact: CountsByImpact;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
};

export type PageSummaryView = PageView & {
  domain: string;
  latestAudit: LatestAuditView | null;
  /**
   * The most recent finished score, and the one before it.
   *
   * Separate from `latestAudit.score`, which is null whenever the last run
   * failed or is still going. The delta badge has to survive that: "-12 since
   * yesterday" must not disappear the moment one audit errors.
   */
  score: number | null;
  previousScore: number | null;
  /** Oldest first, bounded, finished audits only. The sparkline (#20). */
  history: {score: number; at: string}[];
};

const toLatestAuditView = (audit: AuditModel): LatestAuditView => ({
  auditId: audit.publicUuid,
  status: audit.status,
  score: audit.score,
  countsByImpact: audit.countsByImpact,
  createdAt: audit.createdAt.toISOString(),
  completedAt: audit.completedAt?.toISOString() ?? null,
  error: audit.error,
});

export const toPageSummaryView = (summary: PageSummary): PageSummaryView => ({
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
