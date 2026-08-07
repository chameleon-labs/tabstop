import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {sql, type Kysely} from 'kysely';
import {makeDatabase} from '../helpers/postgres-helper.js';
import {explainPlanText, explainRowsRead} from '../test/explain.js';
import type {Database} from '../database.js';

/**
 * A page to hang audits off. Every spec here needs its own, because the
 * constraint under test is per page and the suite runs files in parallel.
 */
const seedPage = async (db: Kysely<Database>): Promise<string> => {
  const user = await db
    .insertInto('users')
    .values({
      email: `${randomUUID()}@example.test`,
      password_digest: 'x',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const site = await db
    .insertInto('sites')
    .values({user_id: user.id, domain: `${randomUUID()}.test`})
    .returning('id')
    .executeTakeFirstOrThrow();

  const page = await db
    .insertInto('pages')
    .values({site_id: site.id, url: `https://${randomUUID()}.test/a`})
    .returning('id')
    .executeTakeFirstOrThrow();

  return page.id;
};

describe('audits.scheduled_for', () => {
  let db: Kysely<Database>;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup');
    db = makeDatabase(url);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('refuses a second scheduled audit for the same page on the same day', async () => {
    const pageId = await seedPage(db);

    await db
      .insertInto('audits')
      .values({page_id: pageId, url: 'https://a.test/x', status: 'queued', scheduled_for: '2026-08-01'})
      .execute();

    await expect(
      db
        .insertInto('audits')
        .values({page_id: pageId, url: 'https://a.test/x', status: 'queued', scheduled_for: '2026-08-01'})
        .execute(),
    ).rejects.toThrow(/audits_one_scheduled_per_page_per_day/);
  });

  it('accepts the next day, which is the whole point of a daily schedule', async () => {
    const pageId = await seedPage(db);

    for (const day of ['2026-08-01', '2026-08-02']) {
      await db
        .insertInto('audits')
        .values({page_id: pageId, url: 'https://a.test/x', status: 'queued', scheduled_for: day})
        .execute();
    }

    const rows = await db.selectFrom('audits').select('id').where('page_id', '=', pageId).execute();

    expect(rows).toHaveLength(2);
  });

  it('leaves unscheduled audits of the same page alone, so a manual re-audit still works', async () => {
    // The reason the constraint keys on `scheduled_for` rather than on the day
    // an audit happened to be created: a "re-audit now" button, whenever one
    // lands, must not be refused because the nightly run already ran - and the
    // first audit a newly added page gets must not block that night's run.
    const pageId = await seedPage(db);

    await db
      .insertInto('audits')
      .values({page_id: pageId, url: 'https://a.test/x', status: 'queued', scheduled_for: '2026-08-01'})
      .execute();

    for (let i = 0; i < 3; i++) {
      await db.insertInto('audits').values({page_id: pageId, url: 'https://a.test/x', status: 'queued'}).execute();
    }

    const unscheduled = await db
      .selectFrom('audits')
      .select('id')
      .where('page_id', '=', pageId)
      .where('scheduled_for', 'is', null)
      .execute();

    expect(unscheduled).toHaveLength(3);
  });

  it('scopes the same day across pages, not across the table', async () => {
    const [first, second] = await Promise.all([seedPage(db), seedPage(db)]);

    for (const pageId of [first, second]) {
      await db
        .insertInto('audits')
        .values({page_id: pageId, url: 'https://a.test/x', status: 'queued', scheduled_for: '2026-08-03'})
        .execute();
    }

    const rows = await db.selectFrom('audits').select('id').where('page_id', 'in', [first, second]).execute();

    expect(rows).toHaveLength(2);
  });

  it('holds the in-flight index only while an audit is unfinished', async () => {
    // The index is partial, so a finished audit leaves it. That is what keeps
    // it small enough to be worth having - asserted rather than assumed,
    // because a predicate that stops matching is invisible until the table is
    // large enough for the missing index to hurt.
    const pageId = await seedPage(db);

    const audit = await db
      .insertInto('audits')
      .values({page_id: pageId, url: 'https://a.test/x', status: 'queued'})
      .returning('id')
      .executeTakeFirstOrThrow();

    const inFlight = async (): Promise<number> => {
      const row = await db
        .selectFrom('audits')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('page_id', '=', pageId)
        .where('status', 'in', ['queued', 'running'] as const)
        .executeTakeFirstOrThrow();
      return Number(row.count);
    };

    expect(await inFlight()).toBe(1);

    await db.updateTable('audits').set({status: 'done'}).where('id', '=', audit.id).execute();

    expect(await inFlight()).toBe(0);
  });

  it("answers the in-flight check without reading the page's audit history", async () => {
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
    const pageId = await seedPage(db);
    await sql`
      insert into audits (page_id, url, status, score)
      select ${pageId}::bigint, 'https://bulk.test/', 'done', (i % 100)
      from generate_series(1, 2000) i
    `.execute(db);
    // Without statistics the planner estimates one row and picks whatever is
    // cheapest for a table it believes is tiny - a fact about missing
    // statistics rather than about the index. Production has them from
    // autovacuum; a spec that bulk-inserts has to ask.
    await sql`analyze audits`.execute(db);

    const probe = {
      sql: "select 1 from audits where page_id = $1 and status in ('queued','running')",
      parameters: [pageId],
    };

    // Rows READ, which counts what a Filter discarded as well as what came
    // back - the distinction the whole assertion rests on, since this
    // predicate returns nothing whether it examined one row or two thousand.
    expect(await explainRowsRead(db, probe, 'audits')).toBeLessThan(50);
    // And on an index rather than the table.
    expect(await explainPlanText(db, probe)).not.toContain('Seq Scan');
  });

  // No assertion above names WHICH index answered that, and the omission is
  // deliberate. It used to name `audits_in_flight_page_idx`, and went red the
  // moment a second partial index over the same live rows existed: Postgres
  // picked the other one, scanning a small index and filtering, which for a
  // live set of a handful is a perfectly good plan. Both indexes cover the
  // same tiny set here, so the choice is the planner's to make; the
  // page-leading one earns its place when the live set is large enough for
  // `page_id = ?` to be the selective predicate, which is the shape a spec
  // cannot cheaply reproduce. Same lesson as #12's lateral - assert the work,
  // not the plan.

  it('finds the oldest unfinished audits without scanning every unfinished audit', async () => {
    // The reclaim pass asks a GLOBAL question - which unfinished audits are old
    // enough to check against the queue - and takes a bounded number, oldest
    // first. That needs `created_at` leading.
    //
    // It was originally a trailing column on the per-page index, which reads
    // plausibly and does not work: with `page_id` unconstrained Postgres cannot
    // walk that index in `created_at` order, so it reads the whole live set and
    // sorts before applying the limit. Harmless while the live set is small,
    // and useless exactly when it is not - which is when a stale backlog has
    // built up and this pass is the thing meant to clear it.
    //
    // A row count rather than a plan name: an index can be named in a plan and
    // still be read end to end, which is the failure mode here.
    const pageId = await seedPage(db);
    const LIVE = 2000;
    // Dated in SECONDS rather than hours, so every one of them is far newer
    // than the cutoffs the reclaim specs beside the audit repository use. This
    // seeds thousands of unfinished audits into a database every spec file
    // shares, and an earlier version spread them over eighty days - which put
    // them at the front of every "oldest first" ordering in the suite and
    // pushed those files' own fixtures out of their results.
    await sql`
      insert into audits (page_id, url, status, created_at)
      select ${pageId}::bigint, 'https://bulk.test/', 'queued',
             now() - ((i || ' seconds')::interval)
      from generate_series(1, ${LIVE}) i
    `.execute(db);
    await sql`analyze audits`.execute(db);

    const probe = {
      sql: `select id from audits
            where status in ('queued','running') and created_at < $1
            order by created_at limit 10`,
      parameters: [new Date()],
    };

    try {
      // Ten rows are wanted, so an ordered walk stops at ten. The whole live
      // set is two orders of magnitude more, and other spec files add their
      // own in-flight rows to it in parallel - which is why the threshold sits
      // well below the seeded count rather than near the limit.
      expect(await explainRowsRead(db, probe, 'audits')).toBeLessThan(LIVE / 4);
    } finally {
      // Finished, so they leave the partial index rather than sitting in it
      // for the rest of the run.
      await db.updateTable('audits').set({status: 'done'}).where('page_id', '=', pageId).execute();
    }
  });

  it('declares every index, with the predicates that make them cheap', async () => {
    const rows = await sql<{indexname: string; indexdef: string}>`
      select indexname, indexdef from pg_indexes
      where tablename = 'audits'
        and indexname in (
          'audits_one_scheduled_per_page_per_day',
          'audits_in_flight_page_idx',
          'audits_in_flight_created_idx'
        )
      order by indexname
    `.execute(db);

    expect(rows.rows.map((row) => row.indexname)).toEqual([
      'audits_in_flight_created_idx',
      'audits_in_flight_page_idx',
      'audits_one_scheduled_per_page_per_day',
    ]);
    // Two access patterns, two indexes, each partial on the live statuses - so
    // both stay small and a finished audit drops out of both.
    // `id` trails it as the cursor's tiebreak, so the reclaim pass can page
    // through rows that share a timestamp without repeating or skipping one.
    expect(rows.rows[0]?.indexdef).toContain('(created_at, id)');
    expect(rows.rows[0]?.indexdef).toContain("status = ANY (ARRAY['queued'::text, 'running'::text])");
    expect(rows.rows[1]?.indexdef).toContain('(page_id)');
    expect(rows.rows[1]?.indexdef).toContain("status = ANY (ARRAY['queued'::text, 'running'::text])");
    expect(rows.rows[2]?.indexdef).toContain('scheduled_for IS NOT NULL');
    expect(rows.rows[2]?.indexdef).toContain('CREATE UNIQUE INDEX');
  });
});
