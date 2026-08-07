import type {Kysely} from 'kysely';
import type {AuditModel} from '../../../../domain/models/audit.js';
import type {PageModel, PageScorePoint, PageSummary} from '../../../../domain/models/page.js';
import type {
  AddPageRepository,
  AddPageRepositoryParams,
  AddPageRepositoryResult,
} from '../../../../data/protocols/db/page/add-page-repository.js';
import type {LoadPageSummariesRepository} from '../../../../data/protocols/db/page/load-page-summaries-repository.js';
import type {SetPageMonitoringRepository} from '../../../../data/protocols/db/page/set-page-monitoring-repository.js';
import type {DeletePageRepository} from '../../../../data/protocols/db/page/delete-page-repository.js';
import type {
  DuePage,
  DuePageQuery,
  LoadDueReauditsRepository,
} from '../../../../data/protocols/db/page/load-due-reaudits-repository.js';
import type {LoadPageHistoryRepository} from '../../../../data/protocols/db/page/load-page-history-repository.js';
import type {PageHistory} from '../../../../domain/usecases/load-page-history.js';
import type {Database} from '../database.js';
import {toAuditModel} from '../audit/audit-mapper.js';
import {toPageModel} from './page-mapper.js';

/**
 * How many recent scores the dashboard sparkline (#20) draws. Bounded in SQL
 * rather than sliced in code: history is never pruned, so "fetch all, keep
 * thirty" costs more for as long as the account exists.
 */
export const HISTORY_POINTS = 30;

const MAX_BIGINT = 9223372036854775807n;

/**
 * Postgres rejects a non-`bigint` (SQLSTATE 22P03, or 22003 on overflow)
 * rather than returning zero rows, so an id from a url path is checked first.
 * A value that cannot BE an id is a miss, not an error - which is what keeps
 * `Promise<PageModel | null>` honest and the database's type checking from
 * becoming a 500.
 */
const isStorableId = (value: string): boolean => /^\d{1,19}$/.test(value) && BigInt(value) <= MAX_BIGINT;

export class PostgresPageRepository
  implements
    AddPageRepository,
    LoadDueReauditsRepository,
    LoadPageSummariesRepository,
    LoadPageHistoryRepository,
    SetPageMonitoringRepository,
    DeletePageRepository
{
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * One transaction, because the four things it does are only correct
   * together.
   *
   * It opens by locking the account's row, which is what makes the cap exact:
   * `count` then `insert` is check-then-act, so without it two concurrent adds
   * both see nine pages and an account that may hold ten holds eleven.
   * Serialising per account is free - adds are rare, accounts never contend -
   * and it is the only lock taken, so there is no order to deadlock on.
   *
   * `userId` comes from the resolved session, never the request body, so it
   * needs no id guard.
   */
  async add(params: AddPageRepositoryParams): Promise<AddPageRepositoryResult> {
    return await this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('users')
        .select('id')
        .where('id', '=', params.userId)
        .forUpdate()
        // Unreachable: sessions cascade from users, so a request that
        // authenticated has an account. Throwing rather than branching keeps
        // an impossible state from acquiring a code path nothing exercises.
        .executeTakeFirstOrThrow();

      // Checked before the cap, so an account at exactly its limit re-adding a
      // page it already tracks is told the useful thing rather than being sold
      // an upgrade it does not need.
      const existing = await trx
        .selectFrom('pages')
        .innerJoin('sites', 'sites.id', 'pages.site_id')
        .select('pages.id')
        .where('sites.user_id', '=', params.userId)
        .where('pages.url', '=', params.url)
        .executeTakeFirst();

      if (existing !== undefined) {
        return {outcome: 'duplicate'};
      }

      const counted = await trx
        .selectFrom('pages')
        .innerJoin('sites', 'sites.id', 'pages.site_id')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('sites.user_id', '=', params.userId)
        .executeTakeFirstOrThrow();

      if (Number(counted.count) >= params.limit) {
        return {outcome: 'limit-reached'};
      }

      const siteId = await this.findOrCreateSite(trx, params.userId, params.domain);

      const page = await trx
        .insertInto('pages')
        .values({site_id: siteId, url: params.url})
        // `do nothing` rather than catching 23505: an error inside a
        // transaction ABORTS it, so everything after would fail with 25P02.
        // This returns zero rows and leaves the transaction usable.
        .onConflict((oc) => oc.constraint('pages_site_id_url_unique').doNothing())
        .returningAll()
        .executeTakeFirst();

      if (page === undefined) {
        return {outcome: 'duplicate'};
      }

      // Inside the transaction so a page cannot exist without a first audit.
      // Only the ENQUEUE has to wait for the commit - a job handed to Redis
      // inside a transaction that then rolls back points at nothing.
      const audit = await trx
        .insertInto('audits')
        .values({url: params.url, page_id: page.id, status: 'queued'})
        .returningAll()
        .executeTakeFirstOrThrow();

      return {outcome: 'added', page: toPageModel(page), firstAudit: toAuditModel(audit)};
    });
  }

  /**
   * One batch of the nightly run's worklist: monitored pages with nothing in
   * flight and nothing audited yet today (#13).
   *
   * Two `not exists` clauses rather than a left join and filter, so each is
   * answered by an index that stops at the first matching row. The first reads
   * the partial `audits_in_flight_page_idx`, without which this walks a page's
   * whole audit history to find nothing, once per page per night.
   *
   * NO age limit on that clause, deliberately: ageing unfinished audits out
   * compounds under load, since on a queue that has not drained real pending
   * audits read as abandoned and their pages pile more work onto the backlog.
   * Whether work is still live is a question only the queue can answer.
   *
   * The second keys on `created_at`, not `scheduled_for`, so a page audited
   * manually an hour ago is not fetched again tonight. Ordered by `pages.id`
   * because the cursor is, so a run that stops early stops reproducibly.
   */
  async loadDueForReaudit(query: DuePageQuery): Promise<DuePage[]> {
    let statement = this.db
      .selectFrom('pages')
      .innerJoin('sites', 'sites.id', 'pages.site_id')
      .select(['pages.id as page_id', 'pages.url', 'sites.domain'])
      .where('pages.monitoring_enabled', '=', true)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('audits')
              .select('audits.id')
              .whereRef('audits.page_id', '=', 'pages.id')
              .where('audits.status', 'in', ['queued', 'running']),
          ),
        ),
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('audits')
              .select('audits.id')
              .whereRef('audits.page_id', '=', 'pages.id')
              .where('audits.created_at', '>=', query.dayStart),
          ),
        ),
      )
      .orderBy('pages.id')
      .limit(query.limit);

    if (query.after !== null) {
      // Strictly greater, so the cursor cannot re-serve the page it points at.
      // The value is one this method returned, so it needs no id guard.
      statement = statement.where('pages.id', '>', query.after);
    }

    const rows = await statement.execute();

    return rows.map((row) => ({pageId: row.page_id, url: row.url, domain: row.domain}));
  }

  async loadSummariesForUser(userId: string): Promise<PageSummary[]> {
    const pageRows = await this.db
      .selectFrom('pages')
      .innerJoin('sites', 'sites.id', 'pages.site_id')
      .select([
        'pages.id',
        'pages.site_id',
        'pages.url',
        'pages.monitoring_enabled',
        'pages.alerts_enabled',
        'pages.created_at',
        'sites.domain',
      ])
      .where('sites.user_id', '=', userId)
      .orderBy('pages.created_at')
      // `now()` is transaction start time, so two pages added in one
      // transaction share a created_at exactly. Without this tie-break their
      // order on the dashboard would be whatever the planner felt like.
      .orderBy('pages.id')
      .execute();

    if (pageRows.length === 0) {
      return [];
    }

    const pageIds = pageRows.map((row) => row.id);
    // Two more queries for the whole list rather than two per page. The naive
    // version is an N+1 that only shows up once somebody tracks ten pages.
    const [latest, history] = await Promise.all([this.loadLatestAudits(pageIds), this.loadRecentScores(pageIds)]);

    return pageRows.map((row) => ({
      page: toPageModel(row),
      domain: row.domain,
      latestAudit: latest.get(row.id) ?? null,
      history: history.get(row.id) ?? [],
    }));
  }

  /**
   * The trend chart's data (#21): one page, every audit since `since`.
   *
   * Ownership is settled by the first statement, so a page belonging to
   * somebody else never reaches the audit read.
   *
   * `audits_page_created_idx` is declared `(page_id, created_at desc)` and
   * this wants ascending; Postgres walks it backwards for the same cost, so
   * the chart gets a list it can render without reversing.
   *
   * No status filter. Every audit in the window is a point, `failed` included.
   */
  async loadHistoryForUser(pageId: string, userId: string, since: Date): Promise<PageHistory | null> {
    if (!isStorableId(pageId)) {
      return null;
    }

    const page = await this.db
      .selectFrom('pages')
      .selectAll('pages')
      .where('pages.id', '=', pageId)
      .where('pages.site_id', 'in', (eb) =>
        eb.selectFrom('sites').select('sites.id').where('sites.user_id', '=', userId),
      )
      .executeTakeFirst();

    if (page === undefined) {
      return null;
    }

    const audits = await this.db
      .selectFrom('audits')
      .selectAll()
      .where('page_id', '=', pageId)
      .where('created_at', '>=', since)
      .orderBy('created_at')
      .execute();

    return {page: toPageModel(page), audits: audits.map(toAuditModel)};
  }

  async setMonitoringForUser(pageId: string, userId: string, monitoringEnabled: boolean): Promise<PageModel | null> {
    if (!isStorableId(pageId)) {
      return null;
    }

    const updated = await this.db
      .updateTable('pages')
      .set({monitoring_enabled: monitoringEnabled})
      .where('id', '=', pageId)
      // The ownership check is part of the statement, not a separate load the
      // caller could skip. A page belonging to somebody else matches nothing,
      // so it is indistinguishable from one that does not exist - which is
      // what stops the response confirming that the row is real.
      .where('site_id', 'in', (eb) => eb.selectFrom('sites').select('sites.id').where('sites.user_id', '=', userId))
      .returningAll()
      .executeTakeFirst();

    return updated === undefined ? null : toPageModel(updated);
  }

  async deleteForUser(pageId: string, userId: string): Promise<boolean> {
    if (!isStorableId(pageId)) {
      return false;
    }

    // Cascades to the page's audits, their violations and their alert events,
    // by the foreign keys #4 declared. Every public share link for those
    // audits stops resolving, which is the intended privacy behaviour.
    const deleted = await this.db
      .deleteFrom('pages')
      .where('id', '=', pageId)
      .where('site_id', 'in', (eb) => eb.selectFrom('sites').select('sites.id').where('sites.user_id', '=', userId))
      .returning('id')
      .executeTakeFirst();

    return deleted !== undefined;
  }

  /**
   * `on conflict do nothing` plus a re-select rather than check-then-insert:
   * losing a race on `sites_user_domain_unique` is a normal outcome and must
   * resolve to the row that won, never to a 500. The lock in `add` makes that
   * race unreachable today; this keeps it correct if that changes.
   */
  private async findOrCreateSite(trx: Kysely<Database>, userId: string, domain: string): Promise<string> {
    const existing = await trx
      .selectFrom('sites')
      .select('id')
      .where('user_id', '=', userId)
      .where('domain', '=', domain)
      .executeTakeFirst();

    if (existing !== undefined) {
      return existing.id;
    }

    const inserted = await trx
      .insertInto('sites')
      .values({user_id: userId, domain})
      .onConflict((oc) => oc.constraint('sites_user_domain_unique').doNothing())
      .returning('id')
      .executeTakeFirst();

    if (inserted !== undefined) {
      return inserted.id;
    }

    const won = await trx
      .selectFrom('sites')
      .select('id')
      .where('user_id', '=', userId)
      .where('domain', '=', domain)
      .executeTakeFirstOrThrow();

    return won.id;
  }

  /**
   * The latest audit per page whatever its status, in one round trip.
   *
   * `distinct on` reads straight off `audits_page_created_idx`, whose column
   * order is exactly this. Status as well as score, because a failed run has
   * to look different from a bad one.
   */
  private async loadLatestAudits(pageIds: string[]): Promise<Map<string, AuditModel>> {
    const rows = await this.db
      .selectFrom('audits')
      .distinctOn('page_id')
      .selectAll()
      .where('page_id', 'in', pageIds)
      .orderBy('page_id')
      .orderBy('created_at', 'desc')
      .execute();

    const byPage = new Map<string, AuditModel>();
    for (const row of rows) {
      if (row.page_id === null) {
        continue;
      }
      byPage.set(row.page_id, toAuditModel(row));
    }
    return byPage;
  }

  /**
   * The last HISTORY_POINTS finished scores for every page at once, oldest
   * first so a sparkline renders in array order.
   *
   * A LATERAL join, so the bound is on WORK and not only on output. A plain
   * `limit` truncates at whichever pages sort first, leaving later pages with
   * no sparkline. `row_number() ... where rank <= 30` emits the right rows but
   * does not stop the scan underneath: measured on Postgres 17 with 3,000
   * audits per page, it read all 30,000 rows and 397 buffers to return 300,
   * whereas this reads 30 rows and 34 buffers and stays there as history
   * grows.
   * The dashboard is the polled endpoint, so its cost must not track how long
   * the account has been a customer.
   */
  private async loadRecentScores(pageIds: string[]): Promise<Map<string, PageScorePoint[]>> {
    const rows = await this.db
      .selectFrom('pages')
      .where('pages.id', 'in', pageIds)
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('audits')
            .select(['audits.page_id', 'audits.score', 'audits.created_at'])
            .whereRef('audits.page_id', '=', 'pages.id')
            // Only a finished audit has a score. A failed one carries null, and
            // a running one carries whatever it had before - neither is a point.
            .where('audits.status', '=', 'done')
            .where('audits.score', 'is not', null)
            // Reads straight off audits_page_created_idx, whose column order -
            // (page_id, created_at desc) - is exactly this.
            .orderBy('audits.created_at', 'desc')
            .limit(HISTORY_POINTS)
            .as('recent'),
        (join) => join.onTrue(),
      )
      .select(['recent.page_id', 'recent.score', 'recent.created_at'])
      .orderBy('recent.page_id')
      .orderBy('recent.created_at')
      .execute();

    const byPage = new Map<string, PageScorePoint[]>();
    for (const row of rows) {
      if (row.page_id === null || row.score === null) {
        continue;
      }
      const points = byPage.get(row.page_id) ?? [];
      points.push({score: row.score, at: row.created_at});
      byPage.set(row.page_id, points);
    }
    return byPage;
  }
}
