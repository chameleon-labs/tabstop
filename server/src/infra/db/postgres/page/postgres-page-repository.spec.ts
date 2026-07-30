import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { CompiledQuery, Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from '../database.js'
import { makeDatabase } from '../helpers/postgres-helper.js'
import { HISTORY_POINTS, PostgresPageRepository } from './postgres-page-repository.js'

type IssuedQuery = { sql: string, parameters: readonly unknown[] }

const connectionUrl = (): string => {
  const url = process.env.DATABASE_URL
  if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
  return url
}

/**
 * A second connection that records the SQL it issues.
 *
 * `makeDatabase` deliberately exposes no logging hook - it is the production
 * factory, and a log option there would be a knob nothing turns. Building the
 * instance here keeps the instrumentation in the only place that wants it.
 */
const makeCountingDatabase = (sink: string[]): Kysely<Database> => new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: connectionUrl() }) }),
  log: (event) => {
    if (event.level === 'query') sink.push(event.query.sql)
  }
})

/** The same, keeping the parameters too, so a query can be re-run under EXPLAIN. */
const makeRecordingDatabase = (sink: IssuedQuery[]): Kysely<Database> => new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: connectionUrl() }) }),
  log: (event) => {
    if (event.level === 'query') {
      sink.push({ sql: event.query.sql, parameters: event.query.parameters })
    }
  }
})

/**
 * Rows read from one relation, across every node of an
 * `EXPLAIN (ANALYZE, FORMAT JSON)` plan that scans it.
 *
 * Narrowed as it walks rather than typed: the plan tree is the planner's to
 * change, and a type describing it would be a claim this spec cannot check.
 *
 * `Actual Rows` is reported PER LOOP, so an inner scan of a nested loop has to
 * be multiplied by its loop count - which is the whole point here, since the
 * lateral form runs one bounded scan per page and the total is what matters.
 *
 * Summing every node's rows instead was the first attempt and is meaningless:
 * it multiplies the answer by the depth of the plan, so a Sort over a Nested
 * Loop over a Limit counts the same thirty rows four times.
 */
const rowsReadFrom = (relation: string, node: unknown): number => {
  if (Array.isArray(node)) {
    return node.reduce<number>((total, child) => total + rowsReadFrom(relation, child), 0)
  }
  if (typeof node !== 'object' || node === null) return 0

  const fields: Record<string, unknown> = { ...node }
  const scanned = fields['Relation Name'] === relation
  const rows = typeof fields['Actual Rows'] === 'number' ? fields['Actual Rows'] : 0
  const loops = typeof fields['Actual Loops'] === 'number' ? fields['Actual Loops'] : 1
  const here = scanned ? rows * loops : 0

  return here + Object.entries(fields)
    .filter(([key]) => key === 'Plans' || key === 'Plan')
    .reduce<number>((total, [, value]) => total + rowsReadFrom(relation, value), 0)
}

const explainRowsRead = async (
  db: Kysely<Database>, query: IssuedQuery, relation: string
): Promise<number> => {
  const explained = await db.executeQuery(CompiledQuery.raw(
    `explain (analyze, format json) ${query.sql}`, [...query.parameters]
  ))

  if (explained.rows.length === 0) throw new Error('EXPLAIN returned no plan')
  return rowsReadFrom(relation, explained.rows)
}

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

    it('reads about thirty audit rows per page, not the whole history', async () => {
      // The bound has to be on WORK, not only on output. `row_number() ...
      // where rank <= 30` returns thirty rows per page and looks equivalent -
      // Postgres 15+ even pushes the comparison into the window as a Run
      // Condition - but the scan underneath still reads every finished audit
      // the page has ever had. On a nightly monitor that means the dashboard,
      // which is the polled endpoint, gets slower for as long as the account
      // exists.
      //
      // Asserted by running EXPLAIN ANALYZE over the query the repository
      // actually issued, so it cannot drift from a copy kept in the spec.
      const issued: Array<{ sql: string, parameters: readonly unknown[] }> = []
      const counting = makeRecordingDatabase(issued)
      const repository = new PostgresPageRepository(counting)

      try {
        const userId = await makeUser()
        const domain = newDomain()
        const added = await sut.add({ userId, domain, url: `https://${domain}/`, limit: 10 })
        if (added.outcome !== 'added') throw new Error('expected the page to be added')

        const history = 200
        for (let index = 0; index < history; index++) {
          await addAudit(added.page.id, { status: 'done', score: index % 100 })
        }

        issued.length = 0
        expect((await repository.loadSummariesForUser(userId))[0]?.history).toHaveLength(30)

        const historyQuery = issued.find((query) => /\blateral\b/i.test(query.sql))
        expect(historyQuery).toBeDefined()
        if (historyQuery === undefined) return

        const rowsRead = await explainRowsRead(counting, historyQuery, 'audits')

        // Thirty for the one page. The window-function version reads all 201
        // and grows from there, so any threshold between them separates the
        // two; this one leaves room for a planner that reads a few extra rows
        // getting past the status filter.
        expect(rowsRead).toBeLessThan(HISTORY_POINTS * 2)
      } finally {
        await counting.destroy()
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
