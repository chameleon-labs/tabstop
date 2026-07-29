import type { AuditModel, AuditStatus } from '../../domain/models/audit.js'
import type { CountsByImpact } from '../../domain/models/impact.js'
import type { PageSummary } from '../../domain/models/page.js'
import type { PageModel } from '../../domain/models/page.js'

/**
 * A page as the API reports it.
 *
 * Built field by field rather than spread from the model, because `PageModel`
 * carries `siteId` - an identifier for a grouping that belongs to the account,
 * which the client has no use for and which a later `select *` would happily
 * put on the wire.
 */
export type PageView = {
  id: string
  url: string
  monitoringEnabled: boolean
  createdAt: string
}

export const toPageView = (page: PageModel): PageView => ({
  id: page.id,
  url: page.url,
  monitoringEnabled: page.monitoringEnabled,
  createdAt: page.createdAt.toISOString()
})

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
  auditId: string
  status: AuditStatus
  score: number | null
  countsByImpact: CountsByImpact
  createdAt: string
  completedAt: string | null
  error: string | null
}

export type PageSummaryView = PageView & {
  domain: string
  latestAudit: LatestAuditView | null
  /**
   * The most recent finished score, and the one before it.
   *
   * Separate from `latestAudit.score`, which is null whenever the last run
   * failed or is still going. The delta badge has to survive that: "-12 since
   * yesterday" must not disappear the moment one audit errors.
   */
  score: number | null
  previousScore: number | null
  /** Oldest first, bounded, finished audits only. The sparkline (#20). */
  history: Array<{ score: number, at: string }>
}

const toLatestAuditView = (audit: AuditModel): LatestAuditView => ({
  auditId: audit.publicUuid,
  status: audit.status,
  score: audit.score,
  countsByImpact: audit.countsByImpact,
  createdAt: audit.createdAt.toISOString(),
  completedAt: audit.completedAt?.toISOString() ?? null,
  error: audit.error
})

export const toPageSummaryView = (summary: PageSummary): PageSummaryView => ({
  ...toPageView(summary.page),
  domain: summary.domain,
  latestAudit: summary.latestAudit === null ? null : toLatestAuditView(summary.latestAudit),
  // History is oldest first, so the two most recent scores are at the end.
  score: summary.history.at(-1)?.score ?? null,
  previousScore: summary.history.at(-2)?.score ?? null,
  history: summary.history.map((point) => ({ score: point.score, at: point.at.toISOString() }))
})
