import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {sql, type Kysely} from 'kysely';
import {makeDatabase} from '../helpers/postgres-helper.js';
import {explainPlanText, explainRowsRead} from '../test/explain.js';
import type {Database} from '../database.js';

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
    if (url === undefined) {
      throw new Error('DATABASE_URL not set by globalSetup');
    }
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
    const pageId = await seedPage(db);
    await sql`
      insert into audits (page_id, url, status, score)
      select ${pageId}::bigint, 'https://bulk.test/', 'done', (i % 100)
      from generate_series(1, 2000) i
    `.execute(db);
    await sql`analyze audits`.execute(db);

    const probe = {
      sql: "select 1 from audits where page_id = $1 and status in ('queued','running')",
      parameters: [pageId],
    };

    expect(await explainRowsRead(db, probe, 'audits')).toBeLessThan(50);
    expect(await explainPlanText(db, probe)).not.toContain('Seq Scan');
  });

  it('finds the oldest unfinished audits without scanning every unfinished audit', async () => {
    const pageId = await seedPage(db);
    const LIVE = 2000;
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
      expect(await explainRowsRead(db, probe, 'audits')).toBeLessThan(LIVE / 4);
    } finally {
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
    expect(rows.rows[0]?.indexdef).toContain('(created_at, id)');
    expect(rows.rows[0]?.indexdef).toContain("status = ANY (ARRAY['queued'::text, 'running'::text])");
    expect(rows.rows[1]?.indexdef).toContain('(page_id)');
    expect(rows.rows[1]?.indexdef).toContain("status = ANY (ARRAY['queued'::text, 'running'::text])");
    expect(rows.rows[2]?.indexdef).toContain('scheduled_for IS NOT NULL');
    expect(rows.rows[2]?.indexdef).toContain('CREATE UNIQUE INDEX');
  });
});
