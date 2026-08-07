import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Kysely} from 'kysely';
import {makeDatabase} from '../helpers/postgres-helper.js';
import type {Database} from '../database.js';

describe('accounts schema', () => {
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

  // Spec files share one database and run in parallel, so every fixture is
  // unique and every assertion is scoped to rows this test created.
  const makeUser = async (): Promise<string> => {
    const user = await db
      .insertInto('users')
      .values({email: `${randomUUID()}@test.test`, password_digest: 'x'})
      .returning('id')
      .executeTakeFirstOrThrow();
    return user.id;
  };

  it('defaults alert_threshold to 5 and rejects out-of-range values', async () => {
    const id = await makeUser();

    const row = await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.alert_threshold).toBe(5);

    // 0 would alert on every audit that merely failed to improve.
    await expect(
      db
        .insertInto('users')
        .values({
          email: `${randomUUID()}@test.test`,
          password_digest: 'x',
          alert_threshold: 0,
        })
        .execute(),
    ).rejects.toThrow(/users_alert_threshold_check/);
  });

  it('reports the named unique constraint on a duplicate email', async () => {
    // The account repository matches this constraint BY NAME to turn a lost
    // signup race into a 409. Renaming it here breaks that mapping silently,
    // so the name is pinned by this test.
    const email = `${randomUUID()}@test.test`;
    await db.insertInto('users').values({email, password_digest: 'x'}).execute();

    await expect(db.insertInto('users').values({email, password_digest: 'y'}).execute()).rejects.toThrow(
      /users_email_unique/,
    );
  });

  it('enforces unique (user_id, domain) but allows the same domain for another user', async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const domain = `${randomUUID()}.test`;

    await db.insertInto('sites').values({user_id: userA, domain}).execute();

    await expect(db.insertInto('sites').values({user_id: userA, domain}).execute()).rejects.toThrow(
      /sites_user_domain_unique/,
    );

    // Two users may legitimately track the same site.
    await db.insertInto('sites').values({user_id: userB, domain}).execute();
    const rows = await db.selectFrom('sites').select('id').where('domain', '=', domain).execute();
    expect(rows).toHaveLength(2);
  });

  it('cascades a user delete through sites, pages, audits, violations, alerts and sessions', async () => {
    const userId = await makeUser();
    const site = await db
      .insertInto('sites')
      .values({user_id: userId, domain: `${randomUUID()}.test`})
      .returning('id')
      .executeTakeFirstOrThrow();
    const page = await db
      .insertInto('pages')
      .values({site_id: site.id, url: 'https://cascade.test/a'})
      .returning('id')
      .executeTakeFirstOrThrow();
    const audit = await db
      .insertInto('audits')
      .values({page_id: page.id, url: 'https://cascade.test/a', status: 'done'})
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('violations')
      .values({
        audit_id: audit.id,
        rule_id: 'image-alt',
        impact: 'critical',
        description: 'Images must have alternate text',
        help_url: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
        nodes: JSON.stringify([]),
      })
      .execute();
    await db
      .insertInto('alert_events')
      .values({
        page_id: page.id,
        audit_id: audit.id,
        kind: 'score_drop',
      })
      .execute();
    await db
      .insertInto('sessions')
      .values({
        id: randomUUID(),
        user_id: userId,
        expires_at: new Date(Date.now() + 60_000),
      })
      .execute();

    await db.deleteFrom('users').where('id', '=', userId).execute();

    const remaining = {
      sites: (await db.selectFrom('sites').select('id').where('id', '=', site.id).execute()).length,
      pages: (await db.selectFrom('pages').select('id').where('id', '=', page.id).execute()).length,
      audits: (await db.selectFrom('audits').select('id').where('id', '=', audit.id).execute()).length,
      violations: (await db.selectFrom('violations').select('id').where('audit_id', '=', audit.id).execute()).length,
      alerts: (await db.selectFrom('alert_events').select('id').where('page_id', '=', page.id).execute()).length,
      sessions: (await db.selectFrom('sessions').select('id').where('user_id', '=', userId).execute()).length,
    };
    expect(remaining).toEqual({
      sites: 0,
      pages: 0,
      audits: 0,
      violations: 0,
      alerts: 0,
      sessions: 0,
    });
  });

  it('excludes an expired session from the auth query', async () => {
    const userId = await makeUser();
    const liveId = randomUUID();
    const deadId = randomUUID();
    await db
      .insertInto('sessions')
      .values({id: liveId, user_id: userId, expires_at: new Date(Date.now() + 3600_000)})
      .execute();
    await db
      .insertInto('sessions')
      .values({id: deadId, user_id: userId, expires_at: new Date(Date.now() - 1000)})
      .execute();

    const live = await db
      .selectFrom('sessions')
      .selectAll()
      .where('id', '=', liveId)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    const dead = await db
      .selectFrom('sessions')
      .selectAll()
      .where('id', '=', deadId)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();

    expect(live?.expires_at).toBeInstanceOf(Date);
    expect(dead).toBeUndefined();
  });

  it('joins page -> site -> user for the alert threshold #14 reads', async () => {
    // sites.user_id is NOT NULL now, so this join is total: every page has
    // exactly one owning user and there is no null case to handle.
    const userId = await makeUser();
    await db.updateTable('users').set({alert_threshold: 12}).where('id', '=', userId).execute();
    const site = await db
      .insertInto('sites')
      .values({user_id: userId, domain: `${randomUUID()}.test`})
      .returning('id')
      .executeTakeFirstOrThrow();
    const page = await db
      .insertInto('pages')
      .values({site_id: site.id, url: 'https://threshold.test/t'})
      .returning('id')
      .executeTakeFirstOrThrow();

    const result = await db
      .selectFrom('pages')
      .innerJoin('sites', 'sites.id', 'pages.site_id')
      .innerJoin('users', 'users.id', 'sites.user_id')
      .select('users.alert_threshold')
      .where('pages.id', '=', page.id)
      .executeTakeFirstOrThrow();

    expect(result.alert_threshold).toBe(12);
  });
});
