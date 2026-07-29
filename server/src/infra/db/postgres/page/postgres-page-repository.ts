import { sql, type Kysely } from 'kysely'
import type { AuditModel } from '../../../../domain/models/audit.js'
import type { PageModel, PageScorePoint, PageSummary } from '../../../../domain/models/page.js'
import type {
  AddPageRepository,
  AddPageRepositoryParams,
  AddPageRepositoryResult
} from '../../../../data/protocols/db/page/add-page-repository.js'
import type {
  LoadPageSummariesRepository
} from '../../../../data/protocols/db/page/load-page-summaries-repository.js'
import type {
  SetPageMonitoringRepository
} from '../../../../data/protocols/db/page/set-page-monitoring-repository.js'
import type {
  DeletePageRepository
} from '../../../../data/protocols/db/page/delete-page-repository.js'
import type { Database } from '../database.js'
import { toAuditModel } from '../audit/audit-mapper.js'
import { toPageModel } from './page-mapper.js'

/**
 * How many recent scores the dashboard sparkline (#20) draws.
 *
 * Bounded in SQL rather than sliced in application code. A monitored page is
 * audited daily and nothing prunes history, so "fetch them all and keep
 * thirty" is a query whose cost grows for as long as the account exists.
 */
const HISTORY_POINTS = 30

const MAX_BIGINT = 9223372036854775807n

/**
 * Postgres rejects a value that cannot be a `bigint` (SQLSTATE 22P03, or 22003
 * when it overflows) instead of returning zero rows, so an id from a url path
 * has to be checked before it reaches a query. A value that cannot BE an id
 * cannot match a row - it is a miss, not an error, which is what keeps
 * `Promise<PageModel | null>` an honest signature.
 *
 * Same rule PostgresAuditRepository applies to `public_uuid`, for the same
 * reason: the database's own type checking must not become a 500.
 */
const isStorableId = (value: string): boolean =>
  /^\d{1,19}$/.test(value) && BigInt(value) <= MAX_BIGINT

export class PostgresPageRepository implements
  AddPageRepository,
  LoadPageSummariesRepository,
  SetPageMonitoringRepository,
  DeletePageRepository {
  constructor (private readonly db: Kysely<Database>) {}

  /**
   * One transaction, because the four things it does are only correct
   * together.
   *
   * It opens by locking the account's own row. That lock is what makes the cap
   * exact: `count` then `insert` is check-then-act, so without it two
   * concurrent adds both see nine pages and both insert, and an account that
   * may hold ten holds eleven. Serialising per account costs nothing real -
   * adds are rare and the ten-page ceiling bounds how long one can take - and
   * accounts never contend with each other. It is also the only lock taken, so
   * there is no acquisition order to deadlock on.
   *
   * `userId` comes from the session that the auth middleware resolved, never
   * from the request body, so it needs no id guard: a value that is not an
   * account id could not have got here.
   */
  async add (params: AddPageRepositoryParams): Promise<AddPageRepositoryResult> {
    return await this.db.transaction().execute(async (trx) => {
      await trx.selectFrom('users')
        .select('id')
        .where('id', '=', params.userId)
        .forUpdate()
        // Unreachable: sessions cascade from users, so a request that
        // authenticated has an account. Throwing rather than branching keeps
        // an impossible state from acquiring a code path nothing exercises.
        .executeTakeFirstOrThrow()

      // Checked before the cap, so an account at exactly its limit re-adding a
      // page it already tracks is told the useful thing rather than being sold
      // an upgrade it does not need.
      const existing = await trx.selectFrom('pages')
        .innerJoin('sites', 'sites.id', 'pages.site_id')
        .select('pages.id')
        .where('sites.user_id', '=', params.userId)
        .where('pages.url', '=', params.url)
        .executeTakeFirst()

      if (existing !== undefined) return { outcome: 'duplicate' }

      const counted = await trx.selectFrom('pages')
        .innerJoin('sites', 'sites.id', 'pages.site_id')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('sites.user_id', '=', params.userId)
        .executeTakeFirstOrThrow()

      if (Number(counted.count) >= params.limit) return { outcome: 'limit-reached' }

      const siteId = await this.findOrCreateSite(trx, params.userId, params.domain)

      const page = await trx.insertInto('pages')
        .values({ site_id: siteId, url: params.url })
        // `do nothing` rather than catching SQLSTATE 23505. A raised error
        // inside a transaction ABORTS it, so every statement after the catch
        // would fail with 25P02 and the recovery would have to be "start
        // over"; this returns zero rows and leaves the transaction usable.
        // Unreachable while the lock above is held, and kept because the
        // constraint is what actually guarantees it.
        .onConflict((oc) => oc.constraint('pages_site_id_url_unique').doNothing())
        .returningAll()
        .executeTakeFirst()

      if (page === undefined) return { outcome: 'duplicate' }

      // Inside the transaction so a page cannot exist without a first audit.
      // Only the ENQUEUE has to wait for the commit - a job handed to Redis
      // inside a transaction that then rolls back points at nothing.
      const audit = await trx.insertInto('audits')
        .values({ url: params.url, page_id: page.id, status: 'queued' })
        .returningAll()
        .executeTakeFirstOrThrow()

      return { outcome: 'added', page: toPageModel(page), firstAudit: toAuditModel(audit) }
    })
  }

  async loadSummariesForUser (userId: string): Promise<PageSummary[]> {
    const pageRows = await this.db.selectFrom('pages')
      .innerJoin('sites', 'sites.id', 'pages.site_id')
      .select([
        'pages.id', 'pages.site_id', 'pages.url', 'pages.monitoring_enabled',
        'pages.created_at', 'sites.domain'
      ])
      .where('sites.user_id', '=', userId)
      .orderBy('pages.created_at')
      // `now()` is transaction start time, so two pages added in one
      // transaction share a created_at exactly. Without this tie-break their
      // order on the dashboard would be whatever the planner felt like.
      .orderBy('pages.id')
      .execute()

    if (pageRows.length === 0) return []

    const pageIds = pageRows.map((row) => row.id)
    // Two more queries for the whole list rather than two per page. The naive
    // version is an N+1 that only shows up once somebody tracks ten pages.
    const [latest, history] = await Promise.all([
      this.loadLatestAudits(pageIds),
      this.loadRecentScores(pageIds)
    ])

    return pageRows.map((row) => ({
      page: toPageModel(row),
      domain: row.domain,
      latestAudit: latest.get(row.id) ?? null,
      history: history.get(row.id) ?? []
    }))
  }

  async setMonitoringForUser (
    pageId: string, userId: string, monitoringEnabled: boolean
  ): Promise<PageModel | null> {
    if (!isStorableId(pageId)) return null

    const updated = await this.db.updateTable('pages')
      .set({ monitoring_enabled: monitoringEnabled })
      .where('id', '=', pageId)
      // The ownership check is part of the statement, not a separate load the
      // caller could skip. A page belonging to somebody else matches nothing,
      // so it is indistinguishable from one that does not exist - which is
      // what stops the response confirming that the row is real.
      .where('site_id', 'in', (eb) =>
        eb.selectFrom('sites').select('sites.id').where('sites.user_id', '=', userId))
      .returningAll()
      .executeTakeFirst()

    return updated === undefined ? null : toPageModel(updated)
  }

  async deleteForUser (pageId: string, userId: string): Promise<boolean> {
    if (!isStorableId(pageId)) return false

    // Cascades to the page's audits, their violations and their alert events,
    // by the foreign keys #4 declared. Every public share link for those
    // audits stops resolving, which is the intended privacy behaviour.
    const deleted = await this.db.deleteFrom('pages')
      .where('id', '=', pageId)
      .where('site_id', 'in', (eb) =>
        eb.selectFrom('sites').select('sites.id').where('sites.user_id', '=', userId))
      .returning('id')
      .executeTakeFirst()

    return deleted !== undefined
  }

  /**
   * Find-or-create, in that order, then find again.
   *
   * `on conflict do nothing` plus a re-select rather than check-then-insert:
   * losing a race on `sites_user_domain_unique` is a normal outcome and must
   * resolve to the row that won, never to a 500. The lock in `add` makes the
   * race unreachable today - this is what keeps that true if it ever stops
   * being.
   */
  private async findOrCreateSite (
    trx: Kysely<Database>, userId: string, domain: string
  ): Promise<string> {
    const existing = await trx.selectFrom('sites')
      .select('id')
      .where('user_id', '=', userId)
      .where('domain', '=', domain)
      .executeTakeFirst()

    if (existing !== undefined) return existing.id

    const inserted = await trx.insertInto('sites')
      .values({ user_id: userId, domain })
      .onConflict((oc) => oc.constraint('sites_user_domain_unique').doNothing())
      .returning('id')
      .executeTakeFirst()

    if (inserted !== undefined) return inserted.id

    const won = await trx.selectFrom('sites')
      .select('id')
      .where('user_id', '=', userId)
      .where('domain', '=', domain)
      .executeTakeFirstOrThrow()

    return won.id
  }

  /**
   * The latest audit per page whatever its status, in one round trip.
   *
   * `distinct on` is the Postgres idiom for it and reads straight off
   * `audits_page_created_idx`, whose column order - (page_id, created_at desc)
   * - is exactly this. The dashboard needs the status rather than only the
   * score, because a failed run has to look different from a bad one.
   */
  private async loadLatestAudits (pageIds: string[]): Promise<Map<string, AuditModel>> {
    const rows = await this.db.selectFrom('audits')
      .distinctOn('page_id')
      .selectAll()
      .where('page_id', 'in', pageIds)
      .orderBy('page_id')
      .orderBy('created_at', 'desc')
      .execute()

    const byPage = new Map<string, AuditModel>()
    for (const row of rows) {
      if (row.page_id === null) continue
      byPage.set(row.page_id, toAuditModel(row))
    }
    return byPage
  }

  /**
   * The last HISTORY_POINTS finished scores for every page at once, oldest
   * first so a sparkline renders in array order.
   *
   * The window function is what bounds it. `limit` cannot: one limit over a
   * multi-page result would cut the list off at whichever pages sorted first.
   */
  private async loadRecentScores (pageIds: string[]): Promise<Map<string, PageScorePoint[]>> {
    const ranked = this.db.selectFrom('audits')
      .select(['page_id', 'score', 'created_at'])
      .select(
        sql<number>`row_number() over (partition by page_id order by created_at desc)`.as('rank')
      )
      .where('page_id', 'in', pageIds)
      // Only a finished audit has a score. A failed one carries null, and a
      // running one carries whatever it had before - neither is a data point.
      .where('status', '=', 'done')
      .where('score', 'is not', null)

    const rows = await this.db.selectFrom(ranked.as('ranked'))
      .select(['page_id', 'score', 'created_at'])
      .where('rank', '<=', HISTORY_POINTS)
      .orderBy('page_id')
      .orderBy('created_at')
      .execute()

    const byPage = new Map<string, PageScorePoint[]>()
    for (const row of rows) {
      if (row.page_id === null || row.score === null) continue
      const points = byPage.get(row.page_id) ?? []
      points.push({ score: row.score, at: row.created_at })
      byPage.set(row.page_id, points)
    }
    return byPage
  }
}
