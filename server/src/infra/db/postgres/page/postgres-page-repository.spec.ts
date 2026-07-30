import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Kysely, PostgresDialect, sql } from 'kysely'
import pg from 'pg'
import type { Database } from '../database.js'
import { makeDatabase } from '../helpers/postgres-helper.js'
import { HISTORY_POINTS, PostgresPageRepository } from './postgres-page-repository.js'
import {
  explainPlanText, explainRowsRead, makeRecordingDatabase, queryMatching, type IssuedQuery
} from '../test/explain.js'
import type {
  DuePage
} from '../../../../data/protocols/db/page/load-due-reaudits-repository.js'

const connectionUrl = (): string => {
  const url = process.env.DATABASE_URL
  if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
  return url
}

/**
 * A counting connection stays local: only this file cares about round trips,
 * and it needs the SQL alone. The EXPLAIN tooling next to it is shared, since
 * the history spec wants it too.
 */
const makeCountingDatabase = (sink: string[]): Kysely<Database> => new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: connectionUrl() }) }),
  log: (event) => {
    if (event.level === 'query') sink.push(event.query.sql)
  }
})

describe('PostgresPageRepository', () => {
  let db: Kysely<Database>
  let sut: PostgresPageRepository

  beforeAll(() => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
    db = makeDatabase(url)
    sut = new PostgresPageRepository(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  // Every fixture is suffixed with a uuid rather than truncating between
  // tests: spec files share one database and run in parallel.
  const makeUser = async (): Promise<string> => {
    const user = await db.insertInto('users')
      .values({ email: `${randomUUID()}@page.test`, password_digest: 'x' })
      .returning('id').executeTakeFirstOrThrow()
    return user.id
  }

  const newDomain = (): string => `${randomUUID()}.test`

  const addAudit = async (
    pageId: string, values: { status: 'queued' | 'running' | 'done' | 'failed', score?: number }
  ): Promise<string> => {
    const audit = await db.insertInto('audits')
      .values({
        page_id: pageId,
        url: `https://${randomUUID()}.test/`,
        status: values.status,
        score: values.score ?? null
      })
      .returning('id').executeTakeFirstOrThrow()
    return audit.id
  }

  describe('add', () => {
    it('creates the site, the page and a queued first audit', async () => {
      const userId = await makeUser()
      const domain = newDomain()
      const url = `https://${domain}/pricing`

      const result = await sut.add({ userId, domain, url, limit: 10 })

      expect(result.outcome).toBe('added')
      if (result.outcome !== 'added') return
      expect(result.page).toEqual({
        id: expect.any(String),
        siteId: expect.any(String),
        url,
        monitoringEnabled: true,
        createdAt: expect.any(Date)
      })
      // The audit exists before anything is enqueued, so the page can never be
      // monitored with no history at all.
      expect(result.firstAudit.status).toBe('queued')
      expect(result.firstAudit.pageId).toBe(result.page.id)
      expect(result.firstAudit.url).toBe(url)
    })

    it('reuses the account\'s existing site for a second page on the same host', async () => {
      const userId = await makeUser()
      const domain = newDomain()

      const first = await sut.add({ userId, domain, url: `https://${domain}/a`, limit: 10 })
      const second = await sut.add({ userId, domain, url: `https://${domain}/b`, limit: 10 })

      expect(first.outcome).toBe('added')
      expect(second.outcome).toBe('added')
      if (first.outcome !== 'added' || second.outcome !== 'added') return
      expect(second.page.siteId).toBe(first.page.siteId)

      const sites = await db.selectFrom('sites').select('id')
        .where('user_id', '=', userId).execute()
      expect(sites).toHaveLength(1)
    })

    it('gives two accounts their own site for the same host', async () => {
      const domain = newDomain()
      const [alice, bob] = await Promise.all([makeUser(), makeUser()])

      const hers = await sut.add({ userId: alice, domain, url: `https://${domain}/`, limit: 10 })
      const his = await sut.add({ userId: bob, domain, url: `https://${domain}/`, limit: 10 })

      expect(hers.outcome).toBe('added')
      expect(his.outcome).toBe('added')
      if (hers.outcome !== 'added' || his.outcome !== 'added') return
      expect(his.page.siteId).not.toBe(hers.page.siteId)
    })

    it('reports a duplicate rather than creating a second page or a second audit', async () => {
      const userId = await makeUser()
      const domain = newDomain()
      const url = `https://${domain}/`

      await sut.add({ userId, domain, url, limit: 10 })
      const again = await sut.add({ userId, domain, url, limit: 10 })

      expect(again.outcome).toBe('duplicate')

      const pages = await db.selectFrom('pages')
        .innerJoin('sites', 'sites.id', 'pages.site_id')
        .select('pages.id').where('sites.user_id', '=', userId).execute()
      expect(pages).toHaveLength(1)

      const audits = await db.selectFrom('audits').select('id')
        .where('page_id', 'in', pages.map((page) => page.id)).execute()
      expect(audits).toHaveLength(1)
    })

    it('answers duplicate before limit-reached for an account already at the cap', async () => {
      // Being told to upgrade when the real answer is "you already track this"
      // is a worse experience than either message alone.
      const userId = await makeUser()
      const domain = newDomain()
      const url = `https://${domain}/0`

      await sut.add({ userId, domain, url, limit: 1 })

      expect((await sut.add({ userId, domain, url, limit: 1 })).outcome).toBe('duplicate')
    })

    it('refuses the page that would exceed the limit', async () => {
      const userId = await makeUser()
      const domain = newDomain()

      await sut.add({ userId, domain, url: `https://${domain}/a`, limit: 2 })
      await sut.add({ userId, domain, url: `https://${domain}/b`, limit: 2 })
      const third = await sut.add({ userId, domain, url: `https://${domain}/c`, limit: 2 })

      expect(third.outcome).toBe('limit-reached')
    })

    it('keeps the limit exact when three adds race', async () => {
      // The reason `add` locks the account row. Counting and then inserting is
      // check-then-act: under READ COMMITTED all three transactions see the
      // same pre-existing count, so without the lock all three are admitted
      // and an account allowed two pages ends up with four.
      const userId = await makeUser()
      const domain = newDomain()
      await sut.add({ userId, domain, url: `https://${domain}/seed`, limit: 2 })

      const results = await Promise.all([
        sut.add({ userId, domain, url: `https://${domain}/a`, limit: 2 }),
        sut.add({ userId, domain, url: `https://${domain}/b`, limit: 2 }),
        sut.add({ userId, domain, url: `https://${domain}/c`, limit: 2 })
      ])

      expect(results.filter((result) => result.outcome === 'added')).toHaveLength(1)
      expect(results.filter((result) => result.outcome === 'limit-reached')).toHaveLength(2)

      const pages = await db.selectFrom('pages')
        .innerJoin('sites', 'sites.id', 'pages.site_id')
        .select('pages.id').where('sites.user_id', '=', userId).execute()
      expect(pages).toHaveLength(2)
    })

    it('does not leave a site behind when the page is refused', async () => {
      const userId = await makeUser()
      const domain = newDomain()
      await sut.add({ userId, domain, url: `https://${domain}/a`, limit: 1 })

      const other = newDomain()
      expect((await sut.add({ userId, domain: other, url: `https://${other}/`, limit: 1 })).outcome)
        .toBe('limit-reached')

      const sites = await db.selectFrom('sites').select('domain')
        .where('user_id', '=', userId).execute()
      expect(sites.map((site) => site.domain)).toEqual([domain])
    })
  })

  describe('loadSummariesForUser', () => {
    it('returns nothing for an account with no pages', async () => {
      expect(await sut.loadSummariesForUser(await makeUser())).toEqual([])
    })

    it('returns each page with its host and its monitoring state, oldest first', async () => {
      const userId = await makeUser()
      const domain = newDomain()
      const first = await sut.add({ userId, domain, url: `https://${domain}/a`, limit: 10 })
      await sut.add({ userId, domain, url: `https://${domain}/b`, limit: 10 })
      if (first.outcome !== 'added') throw new Error('expected the page to be added')
      await sut.setMonitoringForUser(first.page.id, userId, false)

      const summaries = await sut.loadSummariesForUser(userId)

      expect(summaries.map((summary) => summary.page.url))
        .toEqual([`https://${domain}/a`, `https://${domain}/b`])
      expect(summaries.map((summary) => summary.domain)).toEqual([domain, domain])
      expect(summaries[0]?.page.monitoringEnabled).toBe(false)
      expect(summaries[1]?.page.monitoringEnabled).toBe(true)
    })

    it('never returns another account\'s pages', async () => {
      const [alice, bob] = await Promise.all([makeUser(), makeUser()])
      const domain = newDomain()
      await sut.add({ userId: alice, domain, url: `https://${domain}/hers`, limit: 10 })

      expect(await sut.loadSummariesForUser(bob)).toEqual([])
    })

    it('reports the latest audit whatever its status, not the latest scored one', async () => {
      // The dashboard has to make "this page is broken" look different from
      // "this page scores badly". Reporting the last SCORED audit as the
      // latest would hide a page whose monitoring has been failing for a week.
      const userId = await makeUser()
      const domain = newDomain()
      const added = await sut.add({ userId, domain, url: `https://${domain}/`, limit: 10 })
      if (added.outcome !== 'added') throw new Error('expected the page to be added')

      await db.updateTable('audits').set({ status: 'done', score: 80 })
        .where('id', '=', added.firstAudit.id).execute()
      await addAudit(added.page.id, { status: 'failed' })

      const summaries = await sut.loadSummariesForUser(userId)

      expect(summaries[0]?.latestAudit?.status).toBe('failed')
      expect(summaries[0]?.history).toEqual([{ score: 80, at: expect.any(Date) }])
    })

    it('returns finished scores oldest first and caps the history at thirty points', async () => {
      const userId = await makeUser()
      const domain = newDomain()
      const added = await sut.add({ userId, domain, url: `https://${domain}/`, limit: 10 })
      if (added.outcome !== 'added') throw new Error('expected the page to be added')

      // Sequential rather than parallel so created_at orders the way the
      // scores do; the assertion below is about order, so it must not depend
      // on how the database happened to interleave the inserts.
      for (let score = 1; score <= 35; score++) {
        await addAudit(added.page.id, { status: 'done', score })
      }

      const summaries = await sut.loadSummariesForUser(userId)
      const history = summaries[0]?.history ?? []

      expect(history).toHaveLength(30)
      // The newest thirty of thirty-five, still in oldest-first order.
      expect(history.map((point) => point.score)).toEqual(
        Array.from({ length: 30 }, (_value, index) => index + 6)
      )
    })

    it('caps the history PER PAGE rather than across the whole account', async () => {
      // A single `limit 30` over a multi-page result cuts the list off at
      // whichever pages sort first, leaving later pages with no sparkline at
      // all. The window function is what makes the bound per page.
      const userId = await makeUser()
      const domain = newDomain()
      const first = await sut.add({ userId, domain, url: `https://${domain}/a`, limit: 10 })
      const second = await sut.add({ userId, domain, url: `https://${domain}/b`, limit: 10 })
      if (first.outcome !== 'added' || second.outcome !== 'added') {
        throw new Error('expected both pages to be added')
      }

      for (let score = 1; score <= 31; score++) {
        await addAudit(first.page.id, { status: 'done', score })
      }
      await addAudit(second.page.id, { status: 'done', score: 42 })

      const summaries = await sut.loadSummariesForUser(userId)

      expect(summaries[0]?.history).toHaveLength(30)
      expect(summaries[1]?.history.map((point) => point.score)).toEqual([42])
    })

    it('reads about thirty audit rows for a page with two thousand', async () => {
      // The bound has to be on WORK, not only on output. `row_number() ...
      // where rank <= 30` returns thirty rows per page and looks equivalent -
      // Postgres 15+ even pushes the comparison into the window as a Run
      // Condition - but the scan underneath still reads every finished audit
      // the page has ever had. On a nightly monitor that means the dashboard,
      // which is the polled endpoint, gets slower for as long as the account
      // exists.
      //
      // Counted across EVERY query the load issued, not just the one matching
      // some pattern. That matters: the first version of this spec found the
      // history query by searching for `lateral`, so replacing the lateral
      // with the window function made the search fail and the "did we find it"
      // guard went red before the count was ever compared. It looked
      // mutation-checked and was not - and the row counter it relied on was
      // itself returning 0 for every input.
      const issued: IssuedQuery[] = []
      const recording = makeRecordingDatabase(issued)
      const repository = new PostgresPageRepository(recording)

      try {
        const userId = await makeUser()
        const domain = newDomain()
        const added = await sut.add({ userId, domain, url: `https://${domain}/`, limit: 10 })
        if (added.outcome !== 'added') throw new Error('expected the page to be added')

        const history = 2000
        await sql`
          insert into audits (page_id, url, status, score, created_at)
          select ${added.page.id}::bigint, 'https://bulk.test/', 'done', (i % 100),
                 now() - (i || ' hours')::interval
          from generate_series(1, ${history}) i
        `.execute(db)
        // Without this the planner still thinks the page has one audit, picks
        // a bitmap scan with a top-N sort, and reads all 2000 rows even from
        // the lateral - which is a fact about missing statistics rather than
        // about the query. Production has them from autovacuum; a spec that
        // bulk-inserts has to ask.
        await sql`analyze audits`.execute(db)

        issued.length = 0
        expect((await repository.loadSummariesForUser(userId))[0]?.history).toHaveLength(30)

        const queries = [...issued]
        let rowsRead = 0
        for (const query of queries) {
          rowsRead += await explainRowsRead(recording, query, 'audits')
        }

        // Thirty for the history plus one for the latest-audit lookup. The
        // window-function version reads all 2000, so the gap is two orders of
        // magnitude and any threshold between them separates the two.
        expect(rowsRead).toBeGreaterThan(0)
        expect(rowsRead).toBeLessThan(HISTORY_POINTS * 2)
      } finally {
        await recording.destroy()
      }
    })

    it('costs the same number of queries for ten pages as for one', async () => {
      // The acceptance criterion on #11, asserted as the property it actually
      // is: not "three queries" - that number may legitimately change - but
      // that the count does not grow with the list. An N+1 here is invisible
      // until somebody tracks their tenth page, and then it is ten round trips
      // on the one screen the product is opened for.
      const counted: string[] = []
      const counting = makeCountingDatabase(counted)
      const repository = new PostgresPageRepository(counting)

      try {
        const [thin, fat] = await Promise.all([makeUser(), makeUser()])
        const domain = newDomain()
        await sut.add({ userId: thin, domain, url: `https://${domain}/only`, limit: 10 })
        for (let index = 0; index < 10; index++) {
          await sut.add({ userId: fat, domain, url: `https://${domain}/${index}`, limit: 10 })
        }

        counted.length = 0
        await repository.loadSummariesForUser(thin)
        const forOnePage = counted.length

        counted.length = 0
        await repository.loadSummariesForUser(fat)
        const forTenPages = counted.length

        expect(forOnePage).toBeGreaterThan(0)
        expect(forTenPages).toBe(forOnePage)
      } finally {
        await counting.destroy()
      }
    })

    it('leaves a page with no finished audit an empty history rather than a zero', async () => {
      const userId = await makeUser()
      const domain = newDomain()
      const added = await sut.add({ userId, domain, url: `https://${domain}/`, limit: 10 })
      if (added.outcome !== 'added') throw new Error('expected the page to be added')

      const summaries = await sut.loadSummariesForUser(userId)

      expect(summaries[0]?.history).toEqual([])
      expect(summaries[0]?.latestAudit?.status).toBe('queued')
    })
  })

  describe('loadHistoryForUser', () => {
    const daysAgo = (days: number): Date => new Date(Date.now() - days * 86_400_000)

    /** An audit at a chosen moment, which the window specs need to control. */
    const addAuditAt = async (
      pageId: string, at: Date, values: { status: 'done' | 'failed', score?: number }
    ): Promise<void> => {
      await db.insertInto('audits').values({
        page_id: pageId,
        url: `https://${randomUUID()}.test/`,
        status: values.status,
        score: values.score ?? null,
        created_at: at
      }).execute()
    }

    const pageWithHistory = async (): Promise<{ userId: string, pageId: string }> => {
      const userId = await makeUser()
      const domain = newDomain()
      const added = await sut.add({ userId, domain, url: `https://${domain}/`, limit: 10 })
      if (added.outcome !== 'added') throw new Error('expected the page to be added')
      // The first audit is queued and dated now; the specs below add their own.
      await db.deleteFrom('audits').where('id', '=', added.firstAudit.id).execute()
      return { userId, pageId: added.page.id }
    }

    it('returns the page and its audits oldest first', async () => {
      const { userId, pageId } = await pageWithHistory()
      await addAuditAt(pageId, daysAgo(3), { status: 'done', score: 60 })
      await addAuditAt(pageId, daysAgo(1), { status: 'done', score: 80 })
      await addAuditAt(pageId, daysAgo(2), { status: 'done', score: 70 })

      const history = await sut.loadHistoryForUser(pageId, userId, daysAgo(90))

      // Ascending, so the chart renders in array order - the opposite of what
      // `order by created_at desc` habit produces.
      expect(history?.audits.map((audit) => audit.score)).toEqual([60, 70, 80])
      expect(history?.page.id).toBe(pageId)
    })

    it('keeps failed audits as points, with a null score', async () => {
      // Dropping them would make an outage look like continuity; scoring them
      // zero would make it look like a catastrophic regression. The gap is the
      // information.
      const { userId, pageId } = await pageWithHistory()
      await addAuditAt(pageId, daysAgo(2), { status: 'done', score: 90 })
      await addAuditAt(pageId, daysAgo(1), { status: 'failed' })

      const history = await sut.loadHistoryForUser(pageId, userId, daysAgo(90))

      expect(history?.audits.map((audit) => [audit.status, audit.score]))
        .toEqual([['done', 90], ['failed', null]])
    })

    it('excludes audits older than the window', async () => {
      const { userId, pageId } = await pageWithHistory()
      await addAuditAt(pageId, daysAgo(40), { status: 'done', score: 10 })
      await addAuditAt(pageId, daysAgo(5), { status: 'done', score: 20 })

      const history = await sut.loadHistoryForUser(pageId, userId, daysAgo(30))

      expect(history?.audits.map((audit) => audit.score)).toEqual([20])
    })

    it('returns the page with no audits rather than null for a quiet window', async () => {
      // An empty chart and a missing page are different answers: one renders
      // an empty state for a real page, the other is a 404.
      const { userId, pageId } = await pageWithHistory()
      await addAuditAt(pageId, daysAgo(40), { status: 'done', score: 10 })

      const history = await sut.loadHistoryForUser(pageId, userId, daysAgo(30))

      expect(history?.page.id).toBe(pageId)
      expect(history?.audits).toEqual([])
    })

    it('returns null for a page belonging to somebody else', async () => {
      const { pageId } = await pageWithHistory()
      const bob = await makeUser()

      expect(await sut.loadHistoryForUser(pageId, bob, daysAgo(90))).toBeNull()
    })

    it('returns null for an id no bigint column could hold', async () => {
      const userId = await makeUser()

      expect(await sut.loadHistoryForUser('not-a-number', userId, daysAgo(90))).toBeNull()
      expect(await sut.loadHistoryForUser('99999999999999999999', userId, daysAgo(90))).toBeNull()
    })

    it('reads the audits through audits_page_created_idx', async () => {
      // The acceptance criterion on #12, asserted rather than assumed. The
      // index is declared (page_id, created_at desc) and this query wants
      // ascending, which is exactly the shape a planner quietly abandons - and
      // a sequential scan here is invisible until the table is large.
      //
      // Seeded first: on a handful of rows Postgres will correctly prefer a
      // sequential scan, so a spec that asserted the index without enough data
      // would be asserting the opposite of what it means.
      const issued: IssuedQuery[] = []
      const recording = makeRecordingDatabase(issued)
      const repository = new PostgresPageRepository(recording)

      try {
        const { userId, pageId } = await pageWithHistory()
        for (let index = 0; index < 400; index++) {
          await addAuditAt(pageId, daysAgo(index % 80), { status: 'done', score: index % 100 })
        }

        issued.length = 0
        await repository.loadHistoryForUser(pageId, userId, daysAgo(30))

        const auditQuery = queryMatching(issued, /from "audits"/i)
        expect(auditQuery).toBeDefined()
        if (auditQuery === undefined) return

        expect(await explainPlanText(recording, auditQuery))
          .toContain('audits_page_created_idx')
      } finally {
        await recording.destroy()
      }
    })
  })

  describe('loadDueForReaudit', () => {
    const MIDNIGHT_TODAY = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
    const NO_CAP = 10_000
    /** Twelve hours back, matching the grace window the scheduler passes. */
    const IN_FLIGHT_SINCE = new Date(Date.now() - 12 * 60 * 60 * 1000)

    const due = async (
      overrides: {
        limit?: number, after?: string | null, inFlightSince?: Date, dayStart?: Date
      } = {}
    ): Promise<DuePage[]> => await sut.loadDueForReaudit({
      dayStart: overrides.dayStart ?? MIDNIGHT_TODAY,
      inFlightSince: overrides.inFlightSince ?? IN_FLIGHT_SINCE,
      limit: overrides.limit ?? NO_CAP,
      after: overrides.after ?? null
    })

    /**
     * A day boundary no audit can be on the far side of, which switches the
     * "audited today" clause off - so a spec about the in-flight clause is
     * testing the in-flight clause. Without it a fixture dated a few hours ago
     * is excluded by whichever clause fires first, and after midday that is the
     * wrong one, so the assertion passes without exercising what it names.
     *
     * In the FUTURE, not the past. The clause reads `created_at >= dayStart`,
     * so an old boundary matches every audit ever written and excludes every
     * page that has one - the opposite of switching it off.
     */
    const NO_DAY_BOUNDARY = new Date('3000-01-01T00:00:00.000Z')

    /**
     * A monitored page with NO audits at all.
     *
     * `sut.add` would create a queued first audit, which makes the page
     * ineligible - correctly, since it already has work in flight. These specs
     * decide for themselves what history each page has.
     */
    const monitoredPage = async (
      options: { monitoring?: boolean } = {}
    ): Promise<{ pageId: string, domain: string, url: string }> => {
      const userId = await makeUser()
      const domain = newDomain()
      const url = `https://${domain}/`
      const site = await db.insertInto('sites')
        .values({ user_id: userId, domain })
        .returning('id').executeTakeFirstOrThrow()
      const page = await db.insertInto('pages')
        .values({ site_id: site.id, url, monitoring_enabled: options.monitoring ?? true })
        .returning('id').executeTakeFirstOrThrow()
      return { pageId: page.id, domain, url }
    }

    /**
     * Every spec file shares one database and they run in parallel, so this
     * query - which is deliberately global, since the nightly run audits
     * everyone's pages - sees other files' fixtures too. Assertions are made
     * about the pages a spec created, never about the whole result.
     */
    const dueIds = async (limit = NO_CAP): Promise<Set<string>> => new Set(
      (await due({ limit })).map((page) => page.pageId)
    )

    it('returns a monitored page with the domain its jitter keys on', async () => {
      const { pageId, domain, url } = await monitoredPage()

      expect(await due()).toContainEqual({ pageId, url, domain })
    })

    it('skips a page whose monitoring is paused', async () => {
      const { pageId } = await monitoredPage({ monitoring: false })

      expect(await dueIds()).not.toContain(pageId)
    })

    it('skips a page that already has an audit in flight', async () => {
      // Both live statuses, because a page can be either at 02:00: queued from
      // a manual submission that has not started, or running from a job that
      // began before the fan-out did.
      const queued = await monitoredPage()
      const running = await monitoredPage()
      await addAudit(queued.pageId, { status: 'queued' })
      await addAudit(running.pageId, { status: 'running' })

      const ids = await dueIds()

      expect(ids).not.toContain(queued.pageId)
      expect(ids).not.toContain(running.pageId)
    })

    it('stops honouring an unfinished audit once it is older than the grace window', async () => {
      // The bound that keeps a lost enqueue from ending a page's monitoring.
      // A `queued` row with no job behind it stays in flight forever, and
      // while it does its page is absent from every future worklist - silently,
      // with nothing failing anywhere. Without this floor, one blip during one
      // night's fan-out stops that page being monitored for good.
      const { pageId } = await monitoredPage()
      await db.insertInto('audits').values({
        page_id: pageId,
        url: `https://${randomUUID()}.test/`,
        status: 'queued',
        created_at: new Date(Date.now() - 36 * 60 * 60 * 1000)
      }).execute()

      const ids = new Set((await due({ dayStart: NO_DAY_BOUNDARY })).map((page) => page.pageId))

      expect(ids).toContain(pageId)
    })

    it('still honours an unfinished audit inside the window', async () => {
      // The counterpart, and the reason the window is twelve hours rather than
      // something shorter: a page whose scheduled audit is sitting out its
      // six-hour jitter delay has a legitimately queued row, and treating that
      // as abandoned would audit it twice a night.
      const { pageId } = await monitoredPage()
      await db.insertInto('audits').values({
        page_id: pageId,
        url: `https://${randomUUID()}.test/`,
        status: 'queued',
        created_at: new Date(Date.now() - 4 * 60 * 60 * 1000)
      }).execute()

      const ids = new Set((await due({ dayStart: NO_DAY_BOUNDARY })).map((page) => page.pageId))

      expect(ids).not.toContain(pageId)
    })

    it('skips a page already audited today, however that audit came about', async () => {
      // Keyed on created_at rather than on scheduled_for, so a page somebody
      // audited manually an hour ago is not fetched again tonight. That is a
      // cost control the unique index deliberately does not enforce - it only
      // knows about scheduled work.
      const { pageId } = await monitoredPage()
      await addAudit(pageId, { status: 'done', score: 90 })

      expect(await dueIds()).not.toContain(pageId)
    })

    it('returns a page whose last audit was yesterday', async () => {
      // The counterpart to the rule above: a bound that never released would
      // audit every page exactly once, ever.
      const { pageId } = await monitoredPage()
      await db.insertInto('audits').values({
        page_id: pageId,
        url: `https://${randomUUID()}.test/`,
        status: 'done',
        score: 90,
        created_at: new Date(MIDNIGHT_TODAY.getTime() - 3_600_000)
      }).execute()

      expect(await dueIds()).toContain(pageId)
    })

    it('returns a page whose last audit failed, rather than giving up on it', async () => {
      // A failed audit is not work in flight and it is not a result. Excluding
      // these would mean one bad night silently ends monitoring for a page -
      // the failure mode that looks most like the product simply working.
      const { pageId } = await monitoredPage()
      await db.insertInto('audits').values({
        page_id: pageId,
        url: `https://${randomUUID()}.test/`,
        status: 'failed',
        error: 'Navigation timed out',
        created_at: new Date(MIDNIGHT_TODAY.getTime() - 3_600_000)
      }).execute()

      expect(await dueIds()).toContain(pageId)
    })

    it('never returns more pages than the batch allows', async () => {
      await monitoredPage()
      await monitoredPage()

      expect(await due({ limit: 1 })).toHaveLength(1)
    })

    it('starts after the cursor, so the caller can page through', async () => {
      // Keyset, and it has to be: the run mutates what it is paging over -
      // every page it schedules gains an audit in flight and leaves the
      // predicate - so an offset would step over exactly as many pages as the
      // previous batch handled.
      const first = await monitoredPage()
      const second = await monitoredPage()
      const ordered = [first.pageId, second.pageId].sort(
        (left, right) => Number(BigInt(left) - BigInt(right))
      )
      const lower = ordered[0] ?? ''
      const higher = ordered[1] ?? ''

      const ids = new Set((await due({ after: lower })).map((page) => page.pageId))

      expect(ids).toContain(higher)
      expect(ids).not.toContain(lower)
    })

    it('pages through the whole worklist without repeating or skipping a page', async () => {
      // The property the run depends on, asserted end to end rather than
      // inferred from the two rules above: walking one page at a time has to
      // arrive at every row exactly once.
      const mine = new Set(await Promise.all(
        [0, 1, 2].map(async () => (await monitoredPage()).pageId)
      ))

      const seen: string[] = []
      let after: string | null = null
      for (;;) {
        const batch = await due({ limit: 1, after })
        const page = batch[0]
        if (page === undefined) break
        if (mine.has(page.pageId)) seen.push(page.pageId)
        after = page.pageId
      }

      expect(new Set(seen)).toEqual(mine)
      expect(seen).toHaveLength(mine.size)
    })

    // There is deliberately NO assertion here about how much of `audits` this
    // query reads, and the reason is worth writing down.
    //
    // The obvious one - seed a page with thousands of audits, EXPLAIN the
    // load, assert it reads almost none of them - passes when this file runs
    // alone and fails in the suite, measured: 7,635 rows against a threshold
    // of 1,000. Not a flake. This query is global, because the nightly run
    // audits everyone's pages, so it also evaluates every fixture the other
    // spec files are creating in parallel - and once the outer side is a few
    // hundred pages Postgres correctly stops probing per page and hash
    // anti-joins the whole audits table instead. That is the better plan for
    // that shape, so the assertion was pinning the size of the shared fixture
    // set rather than anything about this query.
    //
    // The same lesson #12 recorded about the lateral: an index makes a cheap
    // plan AVAILABLE, it does not guarantee one. What can be pinned is that
    // the index answers the predicate at all, which is asserted next to the
    // migration that creates it.
  })

  describe('setMonitoringForUser', () => {
    it('pauses and resumes without touching the page\'s history', async () => {
      const userId = await makeUser()
      const domain = newDomain()
      const added = await sut.add({ userId, domain, url: `https://${domain}/`, limit: 10 })
      if (added.outcome !== 'added') throw new Error('expected the page to be added')

      const paused = await sut.setMonitoringForUser(added.page.id, userId, false)
      expect(paused?.monitoringEnabled).toBe(false)

      const resumed = await sut.setMonitoringForUser(added.page.id, userId, true)
      expect(resumed?.monitoringEnabled).toBe(true)

      const audits = await db.selectFrom('audits').select('id')
        .where('page_id', '=', added.page.id).execute()
      expect(audits).toHaveLength(1)
    })

    it('returns null for a page belonging to somebody else, and changes nothing', async () => {
      const [alice, bob] = await Promise.all([makeUser(), makeUser()])
      const domain = newDomain()
      const hers = await sut.add({ userId: alice, domain, url: `https://${domain}/`, limit: 10 })
      if (hers.outcome !== 'added') throw new Error('expected the page to be added')

      expect(await sut.setMonitoringForUser(hers.page.id, bob, false)).toBeNull()

      const row = await db.selectFrom('pages').select('monitoring_enabled')
        .where('id', '=', hers.page.id).executeTakeFirstOrThrow()
      expect(row.monitoring_enabled).toBe(true)
    })

    it('returns null for an id no bigint column could hold', async () => {
      // Postgres raises on a malformed bigint comparison rather than matching
      // nothing, so an id from a url path has to be a miss, not a 500.
      const userId = await makeUser()

      expect(await sut.setMonitoringForUser('not-a-number', userId, false)).toBeNull()
      expect(await sut.setMonitoringForUser('99999999999999999999', userId, false)).toBeNull()
      expect(await sut.setMonitoringForUser('', userId, false)).toBeNull()
    })
  })

  describe('deleteForUser', () => {
    it('removes the page and cascades its audits, violations and alert events', async () => {
      const userId = await makeUser()
      const domain = newDomain()
      const added = await sut.add({ userId, domain, url: `https://${domain}/`, limit: 10 })
      if (added.outcome !== 'added') throw new Error('expected the page to be added')

      const auditId = added.firstAudit.id
      await db.insertInto('violations').values({
        audit_id: auditId, rule_id: 'image-alt', impact: 'critical',
        description: 'x', help_url: 'https://example.test', nodes: JSON.stringify([])
      }).execute()
      await db.insertInto('alert_events').values({
        page_id: added.page.id, audit_id: auditId, kind: 'score_drop'
      }).execute()

      expect(await sut.deleteForUser(added.page.id, userId)).toBe(true)

      // Deleting a page revokes every public share link for its audits. That
      // is the intended privacy behaviour, and the reason there is no undo.
      expect(await db.selectFrom('pages').select('id')
        .where('id', '=', added.page.id).executeTakeFirst()).toBeUndefined()
      expect(await db.selectFrom('audits').select('id')
        .where('id', '=', auditId).executeTakeFirst()).toBeUndefined()
      expect(await db.selectFrom('violations').select('id')
        .where('audit_id', '=', auditId).executeTakeFirst()).toBeUndefined()
      expect(await db.selectFrom('alert_events').select('id')
        .where('audit_id', '=', auditId).executeTakeFirst()).toBeUndefined()
    })

    it('leaves the account\'s site behind for its other pages', async () => {
      const userId = await makeUser()
      const domain = newDomain()
      const first = await sut.add({ userId, domain, url: `https://${domain}/a`, limit: 10 })
      await sut.add({ userId, domain, url: `https://${domain}/b`, limit: 10 })
      if (first.outcome !== 'added') throw new Error('expected the page to be added')

      await sut.deleteForUser(first.page.id, userId)

      const remaining = await sut.loadSummariesForUser(userId)
      expect(remaining.map((summary) => summary.page.url)).toEqual([`https://${domain}/b`])
    })

    it('returns false for a page belonging to somebody else, and deletes nothing', async () => {
      const [alice, bob] = await Promise.all([makeUser(), makeUser()])
      const domain = newDomain()
      const hers = await sut.add({ userId: alice, domain, url: `https://${domain}/`, limit: 10 })
      if (hers.outcome !== 'added') throw new Error('expected the page to be added')

      expect(await sut.deleteForUser(hers.page.id, bob)).toBe(false)

      expect(await db.selectFrom('pages').select('id')
        .where('id', '=', hers.page.id).executeTakeFirst()).toBeDefined()
    })

    it('returns false for an id no bigint column could hold', async () => {
      expect(await sut.deleteForUser('not-a-number', await makeUser())).toBe(false)
    })
  })
})
