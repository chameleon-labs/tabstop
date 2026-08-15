import type {AuditStatus, CountsByImpact} from './audit.js';

/**
 * The two 409s `POST /api/pages` answers with, as separate variants.
 *
 * A discriminated union rather than `code: string` because the variants carry
 * different data: only the limit case sends the limit, and a screen saying
 * "tracking 10 of 10 pages" can get that number from nowhere else.
 */
export type PageLimitReachedBody = {
  code: 'page_limit_reached';
  error: string;
  /** The cap that was hit, so the message can name it rather than hardcode it. */
  limit: number;
};

export type PageAlreadyTrackedBody = {
  code: 'page_already_tracked';
  error: string;
};

export type PageConflictBody = PageLimitReachedBody | PageAlreadyTrackedBody;

/** Every code this endpoint may send, for a client that wants to be exhaustive. */
export type PageConflictCode = PageConflictBody['code'];

/**
 * A page as the API reports it.
 *
 * Four fields, listed rather than derived from the server's model, because
 * that model carries `siteId` - an identifier for a grouping that belongs to
 * the account, which no client has a use for and which a later `select *`
 * would happily put on the wire.
 */
export type PageView = {
  id: string;
  url: string;
  monitoringEnabled: boolean;
  createdAt: string;
};

/**
 * The last run, whatever became of it - `queued` and `running` included, since
 * the dashboard shows work in progress.
 *
 * Null means there is no audit row at all. It is NOT "no audit has finished
 * yet": adding a page writes its first audit in the same transaction, so a
 * page added a second ago reports a `queued` audit here. A consumer that reads
 * null as "still waiting" describes a page whose first job failed to enqueue as
 * running, and it will do so forever.
 */
export type LatestPageAudit = {
  /** The public uuid, never the internal id. */
  auditId: string;
  status: AuditStatus;
  score: number | null;
  countsByImpact: CountsByImpact;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
};

/** One point on the dashboard sparkline. Only a finished audit has one. */
export type PageScorePoint = {score: number; at: string};

export type PageSummary = PageView & {
  domain: string;
  latestAudit: LatestPageAudit | null;
  /**
   * The most recent finished score, and the one before it.
   *
   * Separate from `latestAudit.score`, which is null whenever the last run
   * failed or is still going. The delta badge has to survive that: "-12 since
   * yesterday" must not disappear the moment one audit errors.
   */
  score: number | null;
  previousScore: number | null;
  /** Oldest first, bounded, finished audits only. */
  history: PageScorePoint[];
};

export type LoadPagesResponse = {
  pages: PageSummary[];
  limit: number;
  used: number;
};

/**
 * `firstAuditId` is null when the page was created but its first job could not
 * be enqueued - monitoring is on and the next scheduled run will still happen,
 * which is what separates this from a failure.
 */
export type AddPageResponse = PageView & {firstAuditId: string | null};

export type UpdatePageResponse = PageView;
