import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { sql, type Kysely } from 'kysely'
import { makeDatabase } from '../helpers/postgres-helper.js'
import { explainPlanText, explainRowsRead } from '../test/explain.js'
import type { Database } from '../database.js'

/**
 * A page to hang audits off. Every spec here needs its own, because the
 * constraint under test is per page and the suite runs files in parallel.
 */
const seedPage = async (db: Kysely<Database>): Promise<string> => {
  const user = await db.insertInto('users')
    .values({
      email: `${randomUUID()}@example.test`,
      password_digest: 'x'
    })
    .returning('id').executeTakeFirstOrThrow()

  const site = await db.insertInto('sites')
    .values({ user_id: user.id, domain: `${randomUUID()}.test` })
    .returning('id').executeTakeFirstOrThrow()

  const page = await db.insertInto('pages')
    .values({ site_id: site.id, url: `https://${randomUUID()}.test/a` })
    .returning('id').executeTakeFirstOrThrow()

  return page.id
}

describe('audits.scheduled_for', () => {
  let db: Kysely<Database>

  beforeAll(() => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
    db = makeDatabase(url)
  })

  afterAll(async () => {
    await db.destroy()
  })

  it('refuses a second scheduled audit for the same page on the same day', async () => {
    const pageId = await seedPage(db)

    await db.insertInto('audits')
      .values({ page_id: pageId, url: 'https://a.test/x', status: 'queued', scheduled_for: '2026-08-01' })
      .execute()

    await expect(db.insertInto('audits')
      .values({ page_id: pageId, url: 'https://a.test/x', status: 'queued', scheduled_for: '2026-08-01' })
      .execute()
    ).rejects.toThrow(/audits_one_scheduled_per_page_per_day/)
  })

  it('accepts the next day, which is the whole point of a daily schedule', async () => {
    const pageId = await seedPage(db)

    for (const day of ['2026-08-01', '2026-08-02']) {
      await db.insertInto('audits')
        .values({ page_id: pageId, url: 'https://a.test/x', status: 'queued', scheduled_for: day })
        .execute()
    }

    const rows = await db.selectFrom('audits').select('id').where('page_id', '=', pageId).execute()

    expect(rows).toHaveLength(2)
  })

  it('leaves unscheduled audits of the same page alone, so a manual re-audit still works', async () => {
    // The reason the constraint keys on `scheduled_for` rather than on the day
    // an audit happened to be created: #22's "re-audit now" must not be
    // refused because the nightly run already ran, and the first audit a newly
    // added page gets must not block that night's run either.
    const pageId = await seedPage(db)

    await db.insertInto('audits')
      .values({ page_id: pageId, url: 'https://a.test/x', status: 'queued', scheduled_for: '2026-08-01' })
      .execute()

    for (let i = 0; i < 3; i++) {
      await db.insertInto('audits')
        .values({ page_id: pageId, url: 'https://a.test/x', status: 'queued' })
        .execute()
    }

    const unscheduled = await db.selectFrom('audits')
      .select('id')
      .where('page_id', '=', pageId)
      .where('scheduled_for', 'is', null)
      .execute()

    expect(unscheduled).toHaveLength(3)
  })

  it('scopes the same day across pages, not across the table', async () => {
    const [first, second] = await Promise.all([seedPage(db), seedPage(db)])

    for (const pageId of [first, second]) {
      await db.insertInto('audits')
        .values({ page_id: pageId, url: 'https://a.test/x', status: 'queued', scheduled_for: '2026-08-03' })
        .execute()
    }

    const rows = await db.selectFrom('audits')
      .select('id')
      .where('page_id', 'in', [first, second])
      .execute()

    expect(rows).toHaveLength(2)
  })

  it('holds the in-flight index only while an audit is unfinished', async () => {
    // The index is partial, so a finished audit leaves it. That is what keeps
    // it small enough to be worth having - asserted rather than assumed,
    // because a predicate that stops matching is invisible until the table is
    // large enough for the missing index to hurt.
    const pageId = await seedPage(db)

    const audit = await db.insertInto('audits')
      .values({ page_id: pageId, url: 'https://a.test/x', status: 'queued' })
      .returning('id').executeTakeFirstOrThrow()

    const inFlight = async (): Promise<number> => {
      const row = await db.selectFrom('audits')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('page_id', '=', pageId)
        .where('status', 'in', ['queued', 'running'] as const)
        .executeTakeFirstOrThrow()
      return Number(row.count)
    }

    expect(await inFlight()).toBe(1)

    await db.updateTable('audits').set({ status: 'done' }).where('id', '=', audit.id).execute()

    expect(await inFlight()).toBe(0)
  })

  it('answers the in-flight check without reading the page\'s audit history', async () => {
    // What the index is FOR, asserted where the claim is stable.
    //
    // `audits_page_created_idx` can answer "has this page anything queued" by
    // walking every audit the page has ever had and filtering on status - a
    // plan that is correct, invisible, and grows for as long as the account is
    // a customer. This is the predicate #13's eligibility query runs per page,
    // and the assertion is that an index exists which resolves it directly.
    //
    // Not asserted through the repository: that query is global, and once
    // there are enough pages Postgres reasonably switches to a hash anti-join
    // over the whole table - so a plan assertion there measures how many
    // fixtures the parallel spec files happen to have created. Here the shape
    // is fixed: one page, one predicate.
    const pageId = await seedPage(db)
    await sql`
      insert into audits (page_id, url, status, score)
      select ${pageId}::bigint, 'https://bulk.test/', 'done', (i % 100)
      from generate_series(1, 2000) i
    `.execute(db)
    // Without statistics the planner estimates one row and picks whatever is
    // cheapest for a table it believes is tiny - a fact about missing
    // statistics rather than about the index. Production has them from
    // autovacuum; a spec that bulk-inserts has to ask.
    await sql`analyze audits`.execute(db)

    const probe = {
      sql: 'select 1 from audits where page_id = $1 and status in (\'queued\',\'running\')',
      parameters: [pageId]
    }

    // Rows READ, which counts what a Filter discarded as well as what came
    // back - the distinction the whole assertion rests on, since this
    // predicate returns nothing whether it examined one row or two thousand.
    expect(await explainRowsRead(db, probe, 'audits')).toBeLessThan(50)
    // And by the right index. Dropping the partial predicate would leave an
    // index on (page_id) that still appears here by name while reading the
    // page's whole history, which is why the count above is the real
    // assertion and this is the label on it.
    expect(await explainPlanText(db, probe)).toContain('audits_in_flight_page_idx')
  })

  it('declares both indexes, with the predicates that make them cheap', async () => {
    const rows = await sql<{ indexname: string, indexdef: string }>`
      select indexname, indexdef from pg_indexes
      where tablename = 'audits'
        and indexname in ('audits_one_scheduled_per_page_per_day', 'audits_in_flight_page_idx')
      order by indexname
    `.execute(db)

    expect(rows.rows.map((row) => row.indexname)).toEqual([
      'audits_in_flight_page_idx', 'audits_one_scheduled_per_page_per_day'
    ])
    expect(rows.rows[0]?.indexdef).toContain("status = ANY (ARRAY['queued'::text, 'running'::text])")
    expect(rows.rows[1]?.indexdef).toContain('scheduled_for IS NOT NULL')
    expect(rows.rows[1]?.indexdef).toContain('CREATE UNIQUE INDEX')
  })
})
