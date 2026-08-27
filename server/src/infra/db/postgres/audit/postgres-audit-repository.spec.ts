import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {sql, type Kysely} from 'kysely';
import {makeDatabase} from '../helpers/postgres-helper.js';
import {PostgresAuditRepository, claimLeaseFor} from './postgres-audit-repository.js';
import type {Database} from '../database.js';
import type {StaleAudit} from '../../../../data/protocols/db/audit/reclaim-abandoned-audits-repository.js';
import type {CompleteAuditParams} from '../../../../data/protocols/db/audit/complete-audit-repository.js';

describe('PostgresAuditRepository', () => {
  let db: Kysely<Database>;
  let sut: PostgresAuditRepository;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) {
      throw new Error('DATABASE_URL not set by globalSetup');
    }
    db = makeDatabase(url);
    sut = new PostgresAuditRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const makePage = async (): Promise<string> => {
    const user = await db
      .insertInto('users')
      .values({email: `${randomUUID()}@test.test`, password_digest: 'x'})
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

  const complete = async (
    id: string,
    claimedAt: Date,
    result: Omit<CompleteAuditParams, 'violations'>,
  ): Promise<void> => {
    await sut.complete(id, claimedAt, {...result, violations: []});
  };

  const makeAccount = async (pages = 1): Promise<{userId: string; pageIds: string[]}> => {
    const user = await db
      .insertInto('users')
      .values({email: `${randomUUID()}@test.test`, password_digest: 'x'})
      .returning('id')
      .executeTakeFirstOrThrow();
    const site = await db
      .insertInto('sites')
      .values({user_id: user.id, domain: `${randomUUID()}.test`})
      .returning('id')
      .executeTakeFirstOrThrow();
    const pageIds: string[] = [];
    for (let index = 0; index < pages; index++) {
      const page = await db
        .insertInto('pages')
        .values({site_id: site.id, url: `https://${randomUUID()}.test/${index}`})
        .returning('id')
        .executeTakeFirstOrThrow();
      pageIds.push(page.id);
    }
    return {userId: user.id, pageIds};
  };

  const SPEND_DAY = '2026-08-18';

  describe('addOnDemand', () => {
    const ask = async (userId: string, pageId: string, allowance = 1, day = SPEND_DAY) =>
      await sut.addOnDemand({userId, pageId, day, allowance});

    it('attaches the audit to the page, so it lands in that page trend', async () => {
      const {userId, pageIds} = await makeAccount();
      const result = await ask(userId, pageIds[0]!);

      expect(result.outcome).toBe('added');
      if (result.outcome !== 'added') {
        throw new Error('expected an audit');
      }
      expect(result.audit.pageId).toBe(pageIds[0]);
      expect(result.audit.status).toBe('queued');
      expect(result.audit.scheduledFor).toBeNull();
    });

    it('records the spend against the account, linked to the audit it paid for', async () => {
      const {userId, pageIds} = await makeAccount();
      const result = await ask(userId, pageIds[0]!);
      if (result.outcome !== 'added') {
        throw new Error('expected an audit');
      }

      const spends = await db
        .selectFrom('on_demand_audits')
        .select(['audit_id', 'user_id'])
        .where('user_id', '=', userId)
        .execute();

      expect(spends).toEqual([{user_id: userId, audit_id: result.audit.id}]);
    });

    it('survives the page being deleted, so the allowance cannot be refunded', async () => {
      const {userId, pageIds} = await makeAccount(2);
      const first = await ask(userId, pageIds[0]!);
      if (first.outcome !== 'added') {
        throw new Error('expected an audit');
      }

      await db.deleteFrom('pages').where('id', '=', pageIds[0]!).execute();

      expect(await ask(userId, pageIds[1]!)).toEqual({outcome: 'allowance-spent'});
    });

    it('gives another account page the same answer as one that does not exist', async () => {
      const mine = await makeAccount();
      const theirs = await makeAccount();

      expect(await ask(mine.userId, theirs.pageIds[0]!)).toEqual({outcome: 'not-found'});
      expect(await ask(mine.userId, '999999999999')).toEqual({outcome: 'not-found'});
    });

    it('answers not-found rather than raising on an id that could never be a row', async () => {
      const {userId, pageIds} = await makeAccount();

      expect(await ask(userId, 'not-a-number')).toEqual({outcome: 'not-found'});
      expect(await ask(userId, '99999999999999999999')).toEqual({outcome: 'not-found'});
      expect(pageIds).toHaveLength(1);
    });

    it('refuses while an audit for that page is still queued', async () => {
      const {userId, pageIds} = await makeAccount();
      await db.insertInto('audits').values({page_id: pageIds[0]!, url: 'https://x.test/a', status: 'queued'}).execute();

      expect(await ask(userId, pageIds[0]!)).toEqual({outcome: 'in-flight'});
    });

    it('refuses while one is running', async () => {
      const {userId, pageIds} = await makeAccount();
      await db
        .insertInto('audits')
        .values({page_id: pageIds[0]!, url: 'https://x.test/a', status: 'running'})
        .execute();

      expect(await ask(userId, pageIds[0]!)).toEqual({outcome: 'in-flight'});
    });

    it('spends the allowance once and then refuses', async () => {
      const {userId, pageIds} = await makeAccount();
      const first = await ask(userId, pageIds[0]!);
      if (first.outcome !== 'added') {
        throw new Error('expected an audit');
      }
      await db.updateTable('audits').set({status: 'done'}).where('id', '=', first.audit.id).execute();

      expect(await ask(userId, pageIds[0]!)).toEqual({outcome: 'allowance-spent'});
    });

    it('counts the allowance across the account, not per page', async () => {
      const {userId, pageIds} = await makeAccount(2);
      const first = await ask(userId, pageIds[0]!);
      if (first.outcome !== 'added') {
        throw new Error('expected an audit');
      }
      await db.updateTable('audits').set({status: 'done'}).where('id', '=', first.audit.id).execute();

      expect(await ask(userId, pageIds[1]!)).toEqual({outcome: 'allowance-spent'});
    });

    it('does not count a spend from another day', async () => {
      const {userId, pageIds} = await makeAccount();
      await db.insertInto('on_demand_audits').values({user_id: userId, spent_on: '2026-08-17'}).execute();

      expect((await ask(userId, pageIds[0]!)).outcome).toBe('added');
    });

    it('does not count another account spend', async () => {
      const mine = await makeAccount();
      const theirs = await makeAccount();
      await db.insertInto('on_demand_audits').values({user_id: theirs.userId, spent_on: SPEND_DAY}).execute();

      expect((await ask(mine.userId, mine.pageIds[0]!)).outcome).toBe('added');
    });

    it('ignores audits the account did not ask for', async () => {
      const {userId, pageIds} = await makeAccount();
      await db
        .insertInto('audits')
        .values({
          page_id: pageIds[0]!,
          url: 'https://x.test/a',
          status: 'done',
          created_at: new Date('2026-08-18T02:00:00.000Z'),
        })
        .execute();

      expect((await ask(userId, pageIds[0]!)).outcome).toBe('added');
    });

    it('releases the audit and the allowance together when the queue refused it', async () => {
      const {userId, pageIds} = await makeAccount();
      const first = await ask(userId, pageIds[0]!);
      if (first.outcome !== 'added') {
        throw new Error('expected an audit');
      }

      await sut.releaseOnDemand(first.audit.id);

      expect(await db.selectFrom('on_demand_audits').select('id').where('user_id', '=', userId).execute()).toEqual([]);
      expect((await ask(userId, pageIds[0]!)).outcome).toBe('added');
    });

    it('leaves a released audit that has already started alone, allowance included', async () => {
      const {userId, pageIds} = await makeAccount();
      const first = await ask(userId, pageIds[0]!);
      if (first.outcome !== 'added') {
        throw new Error('expected an audit');
      }
      await db.updateTable('audits').set({status: 'running'}).where('id', '=', first.audit.id).execute();

      await sut.releaseOnDemand(first.audit.id);

      expect(
        await db.selectFrom('audits').select('id').where('id', '=', first.audit.id).executeTakeFirst(),
      ).toBeDefined();
      expect(await db.selectFrom('on_demand_audits').select('id').where('user_id', '=', userId).execute()).toHaveLength(
        1,
      );
    });

    it('refuses a scheduled audit for a page an on-demand run already holds', async () => {
      const {userId, pageIds} = await makeAccount();
      const asked = await ask(userId, pageIds[0]!);
      if (asked.outcome !== 'added') {
        throw new Error('expected an audit');
      }

      const scheduled = await sut.addScheduled({
        pageId: pageIds[0]!,
        url: 'https://x.test/a',
        scheduledFor: SPEND_DAY,
      });

      expect(scheduled).toBeNull();
    });

    it('refuses a scheduled audit for a page already audited on demand that day', async () => {
      const {userId, pageIds} = await makeAccount();
      const asked = await ask(userId, pageIds[0]!);
      if (asked.outcome !== 'added') {
        throw new Error('expected an audit');
      }
      await db.updateTable('audits').set({status: 'done', score: 91}).where('id', '=', asked.audit.id).execute();

      const scheduled = await sut.addScheduled({
        pageId: pageIds[0]!,
        url: 'https://x.test/a',
        scheduledFor: SPEND_DAY,
      });

      expect(scheduled).toBeNull();
    });

    it('refuses while yesterday on-demand audit is still queued tonight', async () => {
      const {userId, pageIds} = await makeAccount();
      const asked = await ask(userId, pageIds[0]!, 1, '2026-08-17');
      if (asked.outcome !== 'added') {
        throw new Error('expected an audit');
      }

      const scheduled = await sut.addScheduled({
        pageId: pageIds[0]!,
        url: 'https://x.test/a',
        scheduledFor: SPEND_DAY,
      });

      expect(scheduled).toBeNull();
    });

    it('schedules a page whose on-demand audit was a different day and has finished', async () => {
      const {userId, pageIds} = await makeAccount();
      const asked = await ask(userId, pageIds[0]!, 1, '2026-08-17');
      if (asked.outcome !== 'added') {
        throw new Error('expected an audit');
      }
      await db.updateTable('audits').set({status: 'done', score: 91}).where('id', '=', asked.audit.id).execute();

      const scheduled = await sut.addScheduled({
        pageId: pageIds[0]!,
        url: 'https://x.test/a',
        scheduledFor: SPEND_DAY,
      });

      expect(scheduled).not.toBeNull();
    });

    it('waits behind the nightly run rather than inserting alongside it', async () => {
      const url = process.env.DATABASE_URL;
      if (url === undefined) {
        throw new Error('DATABASE_URL not set by globalSetup');
      }
      const {userId, pageIds} = await makeAccount();
      const second = makeDatabase(url);

      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => {
        locked = resolve;
      });

      const holding = db.transaction().execute(async (trx) => {
        await trx.selectFrom('pages').select('id').where('id', '=', pageIds[0]!).forNoKeyUpdate().execute();
        locked();
        await held;
      });

      try {
        await lockTaken;
        const asking = new PostgresAuditRepository(second).addOnDemand({
          userId,
          pageId: pageIds[0]!,
          day: SPEND_DAY,
          allowance: 1,
        });

        const outcome = await Promise.race([
          asking.then(() => 'completed' as const),
          new Promise<'blocked'>((resolve) => {
            setTimeout(() => {
              resolve('blocked');
            }, 250);
          }),
        ]);
        expect(outcome).toBe('blocked');

        release();
        await holding;

        expect((await asking).outcome).toBe('added');
      } finally {
        release();
        await holding.catch(() => undefined);
        await second.destroy();
      }
    });

    it('audits a paused page, because pausing stops the schedule and not the person', async () => {
      const {userId, pageIds} = await makeAccount();
      await db.updateTable('pages').set({monitoring_enabled: false}).where('id', '=', pageIds[0]!).execute();

      expect((await ask(userId, pageIds[0]!)).outcome).toBe('added');
    });

    it('waits behind another request from the same account rather than counting past it', async () => {
      const url = process.env.DATABASE_URL;
      if (url === undefined) {
        throw new Error('DATABASE_URL not set by globalSetup');
      }
      const {userId, pageIds} = await makeAccount(2);
      const second = makeDatabase(url);

      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => {
        locked = resolve;
      });

      const holding = db.transaction().execute(async (trx) => {
        await trx.selectFrom('users').select('id').where('id', '=', userId).forNoKeyUpdate().execute();
        locked();
        await held;
      });

      try {
        await lockTaken;
        const asking = new PostgresAuditRepository(second).addOnDemand({
          userId,
          pageId: pageIds[0]!,
          day: SPEND_DAY,
          allowance: 1,
        });

        const outcome = await Promise.race([
          asking.then(() => 'completed' as const),
          new Promise<'blocked'>((resolve) => {
            setTimeout(() => {
              resolve('blocked');
            }, 250);
          }),
        ]);
        expect(outcome).toBe('blocked');

        release();
        await holding;

        expect((await asking).outcome).toBe('added');
      } finally {
        release();
        await holding.catch(() => undefined);
        await second.destroy();
      }
    });
  });

  describe('add', () => {
    it('creates a queued anonymous audit', async () => {
      const url = `https://${randomUUID()}.test/x`;
      const audit = await sut.add({url, pageId: null});

      expect(audit.status).toBe('queued');
      expect(audit.pageId).toBeNull();
      expect(audit.url).toBe(url);
    });

    it('returns an id and an unguessable public uuid, which are not the same value', async () => {
      const audit = await sut.add({url: `https://${randomUUID()}.test/y`, pageId: null});

      expect(typeof audit.id).toBe('string');
      expect(audit.publicUuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(audit.publicUuid).not.toBe(audit.id);
    });

    it('defaults counts to zero for every impact', async () => {
      const audit = await sut.add({url: `https://${randomUUID()}.test/z`, pageId: null});

      expect(audit.countsByImpact).toEqual({minor: 0, moderate: 0, serious: 0, critical: 0});
    });

    it('leaves the result fields empty until the worker fills them', async () => {
      const audit = await sut.add({url: `https://${randomUUID()}.test/w`, pageId: null});

      expect(audit.score).toBeNull();
      expect(audit.axeVersion).toBeNull();
      expect(audit.durationMs).toBeNull();
      expect(audit.error).toBeNull();
      expect(audit.completedAt).toBeNull();
    });

    it('attaches the audit to a page when given one', async () => {
      const pageId = await makePage();

      const audit = await sut.add({url: `https://${randomUUID()}.test/a`, pageId});

      expect(audit.pageId).toBe(pageId);
    });
  });

  describe('addScheduled', () => {
    const DAY = '2026-08-01';

    it("creates the queued audit for a page's nightly run", async () => {
      const pageId = await makePage();
      const url = `https://${randomUUID()}.test/a`;

      const audit = await sut.addScheduled({pageId, url, scheduledFor: DAY});

      expect(audit?.status).toBe('queued');
      expect(audit?.pageId).toBe(pageId);
      expect(audit?.url).toBe(url);
    });

    it('answers null rather than throwing when the day is already scheduled', async () => {
      const pageId = await makePage();
      const url = `https://${randomUUID()}.test/a`;

      const first = await sut.addScheduled({pageId, url, scheduledFor: DAY});
      const second = await sut.addScheduled({pageId, url, scheduledFor: DAY});

      expect(first).not.toBeNull();
      expect(second).toBeNull();

      const rows = await db.selectFrom('audits').select('id').where('page_id', '=', pageId).execute();
      expect(rows).toHaveLength(1);
    });

    it('leaves the connection usable after a conflict', async () => {
      const pageId = await makePage();
      const url = `https://${randomUUID()}.test/a`;
      await sut.addScheduled({pageId, url, scheduledFor: DAY});

      await sut.addScheduled({pageId, url, scheduledFor: DAY});

      expect(await sut.addScheduled({pageId, url, scheduledFor: '2026-08-02'})).not.toBeNull();
    });

    it('schedules the same page again the next day', async () => {
      const pageId = await makePage();
      const url = `https://${randomUUID()}.test/a`;

      const monday = await sut.addScheduled({pageId, url, scheduledFor: DAY});
      const tuesday = await sut.addScheduled({pageId, url, scheduledFor: '2026-08-02'});

      expect(monday?.id).not.toBe(tuesday?.id);
    });

    it('does not block an unscheduled audit of the same page on the same day', async () => {
      const pageId = await makePage();
      const url = `https://${randomUUID()}.test/a`;
      await sut.addScheduled({pageId, url, scheduledFor: DAY});

      const manual = await sut.add({url, pageId});

      expect(manual.pageId).toBe(pageId);
      const rows = await db.selectFrom('audits').select('id').where('page_id', '=', pageId).execute();
      expect(rows).toHaveLength(2);
    });
  });

  describe('reclaiming abandoned audits', () => {
    const hoursAgo = (hours: number): Date => new Date(Date.now() - hours * 3_600_000);

    const inFlightAudit = async (status: 'queued' | 'running', createdAt: Date): Promise<string> => {
      const pageId = await makePage();
      const audit = await db
        .insertInto('audits')
        .values({
          page_id: pageId,
          url: `https://${randomUUID()}.test/a`,
          status,
          created_at: createdAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return audit.id;
    };

    const staleIds = async (olderThan: Date, limit = 1000, after: StaleAudit | null = null): Promise<string[]> =>
      (await sut.loadStaleInFlight(olderThan, limit, after)).map((row) => row.auditId);

    it('offers unfinished audits older than the cutoff, in both live statuses', async () => {
      const queued = await inFlightAudit('queued', hoursAgo(30));
      const running = await inFlightAudit('running', hoursAgo(30));

      const stale = await staleIds(hoursAgo(12));

      expect(stale).toContain(queued);
      expect(stale).toContain(running);
    });

    it('leaves finished audits alone however old they are', async () => {
      const pageId = await makePage();
      const done = await db
        .insertInto('audits')
        .values({
          page_id: pageId,
          url: `https://${randomUUID()}.test/a`,
          status: 'done',
          score: 90,
          created_at: hoursAgo(500),
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      expect(await staleIds(hoursAgo(12))).not.toContain(done.id);
    });

    it('leaves recent unfinished audits alone', async () => {
      const recent = await inFlightAudit('queued', hoursAgo(1));

      expect(await staleIds(hoursAgo(12))).not.toContain(recent);
    });

    it('offers the oldest first, since that is where the abandoned ones are', async () => {
      const older = await inFlightAudit('queued', hoursAgo(400));
      const newer = await inFlightAudit('queued', hoursAgo(300));

      const stale = await staleIds(hoursAgo(200));

      expect(stale.indexOf(older)).toBeLessThan(stale.indexOf(newer));
    });

    it('honours the limit, so one batch cannot become an unbounded scan', async () => {
      await inFlightAudit('queued', hoursAgo(30));
      await inFlightAudit('queued', hoursAgo(30));

      expect(await staleIds(hoursAgo(12), 1)).toHaveLength(1);
    });

    const cursorFor = async (auditId: string, olderThan: Date): Promise<StaleAudit> => {
      const rows = await sut.loadStaleInFlight(olderThan, 10_000, null);
      const found = rows.find((row) => row.auditId === auditId);
      if (found === undefined) {
        throw new Error(`${auditId} was not offered as a candidate`);
      }
      return found;
    };

    it('resumes after the cursor rather than serving the same batch again', async () => {
      const first = await inFlightAudit('queued', hoursAgo(500));
      const second = await inFlightAudit('queued', hoursAgo(499));

      const next = await staleIds(hoursAgo(400), 1000, await cursorFor(first, hoursAgo(400)));

      expect(next).toContain(second);
      expect(next).not.toContain(first);
    });

    it('does not serve a row again as its own successor', async () => {
      const pageId = await makePage();
      const cutoff = new Date('2026-07-02T00:00:00Z');
      const inserted = await db
        .insertInto('audits')
        .values({
          page_id: pageId,
          url: 'https://micro.test/',
          status: 'queued',
          created_at: sql<Date>`timestamptz '2026-07-01 00:00:00.123456+00'`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const next = await staleIds(cutoff, 1000, await cursorFor(inserted.id, cutoff));

      expect(next).not.toContain(inserted.id);
    });

    it('separates rows sharing a timestamp, which is why the cursor carries the id', async () => {
      const sharedAt = hoursAgo(600);
      const [first, ...rest] = [
        await inFlightAudit('queued', sharedAt),
        await inFlightAudit('queued', sharedAt),
        await inFlightAudit('queued', sharedAt),
      ];
      if (first === undefined) {
        return;
      }

      const after = await staleIds(hoursAgo(550), 1000, await cursorFor(first, hoursAgo(550)));

      for (const auditId of rest) {
        expect(after).toContain(auditId);
      }
      expect(after).not.toContain(first);
    });

    it('retires an abandoned audit as failed rather than deleting it', async () => {
      const auditId = await inFlightAudit('queued', hoursAgo(30));

      expect(await sut.markAbandoned(auditId, 'Abandoned')).toBe(true);

      const row = await sut.loadById(auditId);
      expect(row?.status).toBe('failed');
      expect(row?.error).toBe('Abandoned');
      expect(row?.completedAt).toBeInstanceOf(Date);
    });

    it('refuses to touch an audit that has already finished', async () => {
      const auditId = await inFlightAudit('running', hoursAgo(30));
      await db.updateTable('audits').set({status: 'done', score: 88}).where('id', '=', auditId).execute();

      expect(await sut.markAbandoned(auditId, 'Abandoned')).toBe(false);

      const row = await sut.loadById(auditId);
      expect(row?.status).toBe('done');
      expect(row?.score).toBe(88);
    });

    it('reports false the second time, so a race is not counted twice', async () => {
      const auditId = await inFlightAudit('queued', hoursAgo(30));

      expect(await sut.markAbandoned(auditId, 'Abandoned')).toBe(true);
      expect(await sut.markAbandoned(auditId, 'Abandoned')).toBe(false);
    });
  });

  describe('loadByPublicUuid', () => {
    it('returns the audit that was created', async () => {
      const created = await sut.add({url: `https://${randomUUID()}.test/find-me`, pageId: null});

      const found = await sut.loadByPublicUuid(created.publicUuid);

      expect(found).toEqual(created);
    });

    it('returns null for an unknown uuid', async () => {
      const found = await sut.loadByPublicUuid('00000000-0000-0000-0000-000000000000');

      expect(found).toBeNull();
    });

    it('returns null for a malformed uuid instead of rejecting', async () => {
      const found = await sut.loadByPublicUuid('not-a-uuid');

      expect(found).toBeNull();
    });
  });

  describe('status transitions', () => {
    const makeQueuedAudit = async (): Promise<string> => {
      const audit = await sut.add({url: `https://${randomUUID()}.test/x`, pageId: null});
      return audit.id;
    };

    const makeClaimedAudit = async (): Promise<{id: string; claimedAt: Date}> => {
      const id = await makeQueuedAudit();
      const claimedAt = await sut.claimForRun(id);
      if (claimedAt === null) {
        throw new Error('fixture failed to claim');
      }
      return {id, claimedAt};
    };

    const load = async (id: string) =>
      await db.selectFrom('audits').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

    it('claims a queued audit', async () => {
      const id = await makeQueuedAudit();

      expect(await sut.claimForRun(id)).toBeInstanceOf(Date);
      expect((await load(id)).status).toBe('running');
    });

    it('refuses a second claim while the first is still live', async () => {
      const id = await makeQueuedAudit();
      await sut.claimForRun(id);

      expect(await sut.claimForRun(id)).toBeNull();
    });

    it('reclaims an audit whose worker died and left the claim stale', async () => {
      const id = await makeQueuedAudit();
      await sut.claimForRun(id);

      await db
        .updateTable('audits')
        .set({claimed_at: new Date(Date.now() - 60 * 60_000)})
        .where('id', '=', id)
        .execute();

      expect(await sut.claimForRun(id)).toBeInstanceOf(Date);
    });

    it('lets exactly one of several concurrent deliveries claim a queued audit', async () => {
      const id = await makeQueuedAudit();

      const claims = await Promise.all([sut.claimForRun(id), sut.claimForRun(id), sut.claimForRun(id)]);

      expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    });

    it('refuses to resurrect an audit that already finished', async () => {
      for (const finish of ['done', 'failed'] as const) {
        const {id, claimedAt} = await makeClaimedAudit();
        if (finish === 'done') {
          await complete(id, claimedAt, {
            score: 100,
            countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
            axeVersion: '4.12.1',
            durationMs: 1,
            settled: true,
          });
        } else {
          await sut.markFailed(id, claimedAt, 'Could not resolve that domain');
        }

        expect(await sut.claimForRun(id)).toBeNull();
        expect((await load(id)).status).toBe(finish);
      }
    });

    it('refuses every concurrent delivery once the audit has finished', async () => {
      const {id, claimedAt} = await makeClaimedAudit();
      await complete(id, claimedAt, {
        score: 100,
        countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
        axeVersion: '4.12.1',
        durationMs: 1,
        settled: true,
      });

      const claims = await Promise.all([sut.claimForRun(id), sut.claimForRun(id), sut.claimForRun(id)]);

      expect(claims).toEqual([null, null, null]);
    });

    it('ignores a terminal write from an attempt that lost its claim', async () => {
      const {id, claimedAt} = await makeClaimedAudit();
      await db
        .updateTable('audits')
        .set({claimed_at: new Date(Date.now() - 60 * 60_000)})
        .where('id', '=', id)
        .execute();
      const newOwner = await sut.claimForRun(id);
      if (newOwner === null) {
        throw new Error('fixture failed to reclaim');
      }
      await complete(id, newOwner, {
        score: 100,
        countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
        axeVersion: '4.12.1',
        durationMs: 1,
        settled: true,
      });

      await sut.markFailed(id, claimedAt, 'stale attempt reporting failure');

      const row = await load(id);
      expect(row.status).toBe('done');
      expect(row.error).toBeNull();
    });

    it('lets the next attempt claim once the previous one released', async () => {
      const id = await makeQueuedAudit();
      const claimedAt = await sut.claimForRun(id);
      if (claimedAt === null) {
        throw new Error('fixture failed to claim');
      }

      await sut.releaseClaim(id, claimedAt);

      expect((await load(id)).status).toBe('queued');
      expect(await sut.claimForRun(id)).toBeInstanceOf(Date);
    });

    it('ignores a release from an attempt that no longer holds the claim', async () => {
      const id = await makeQueuedAudit();
      const stale = await sut.claimForRun(id);
      if (stale === null) {
        throw new Error('fixture failed to claim');
      }
      await sut.releaseClaim(id, stale);
      const current = await sut.claimForRun(id);

      await sut.releaseClaim(id, stale);

      expect(current).toBeInstanceOf(Date);
      expect((await load(id)).status).toBe('running');
    });

    it('refuses to drag a finished audit back to queued', async () => {
      const {id, claimedAt} = await makeClaimedAudit();
      await sut.markFailed(id, claimedAt, 'Could not resolve that domain');

      await sut.releaseClaim(id, claimedAt);

      expect((await load(id)).status).toBe('failed');
    });

    it('marks an audit done with counts, version, duration and settled', async () => {
      const {id, claimedAt} = await makeClaimedAudit();

      await complete(id, claimedAt, {
        score: 42,
        countsByImpact: {minor: 1, moderate: 0, serious: 2, critical: 3},
        axeVersion: '4.12.1',
        durationMs: 1234,
        settled: false,
      });

      const row = await load(id);
      expect(row.status).toBe('done');
      expect(row.score).toBe(42);
      expect(row.counts_by_impact).toEqual({minor: 1, moderate: 0, serious: 2, critical: 3});
      expect(row.axe_version).toBe('4.12.1');
      expect(row.duration_ms).toBe(1234);
      expect(row.settled).toBe(false);
      expect(row.completed_at).toBeInstanceOf(Date);
    });

    it('writes all four impact keys, which the check constraint requires', async () => {
      const {id, claimedAt} = await makeClaimedAudit();

      await complete(id, claimedAt, {
        score: 100,
        countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
        axeVersion: '4.12.1',
        durationMs: 10,
        settled: true,
      });

      expect((await load(id)).counts_by_impact).toEqual({minor: 0, moderate: 0, serious: 0, critical: 0});
    });

    it('persists both ends of the score range', async () => {
      for (const score of [0, 100]) {
        const {id, claimedAt} = await makeClaimedAudit();
        await complete(id, claimedAt, {
          score,
          countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
          axeVersion: '4.12.1',
          durationMs: 1,
          settled: true,
        });

        expect((await load(id)).score).toBe(score);
      }
    });

    it('marks an audit failed with a readable message and a completion time', async () => {
      const {id, claimedAt} = await makeClaimedAudit();

      await sut.markFailed(id, claimedAt, 'Could not resolve that domain');

      const row = await load(id);
      expect(row.status).toBe('failed');
      expect(row.error).toBe('Could not resolve that domain');
      expect(row.completed_at).toBeInstanceOf(Date);
    });
  });

  describe('loadById', () => {
    it('returns the audit for an internal id', async () => {
      const created = await sut.add({url: `https://${randomUUID()}.test/x`, pageId: null});

      expect(await sut.loadById(created.id)).toEqual(created);
    });

    it('returns null for an id that does not exist', async () => {
      expect(await sut.loadById('999999999')).toBeNull();
    });
  });

  describe('addScheduled and a page paused mid-run', () => {
    it('schedules nothing for a page that is no longer monitored', async () => {
      const pageId = await makePage();
      await db.updateTable('pages').set({monitoring_enabled: false}).where('id', '=', pageId).execute();

      const audit = await sut.addScheduled({
        pageId,
        url: `https://${randomUUID()}.test/x`,
        scheduledFor: '2026-08-17',
      });

      expect(audit).toBeNull();
      expect(await db.selectFrom('audits').select('id').where('page_id', '=', pageId).execute()).toEqual([]);
    });

    it('waits for a pause in flight rather than slipping in behind it', async () => {
      const url = process.env.DATABASE_URL;
      if (url === undefined) {
        throw new Error('DATABASE_URL not set by globalSetup');
      }
      const pageId = await makePage();
      const second = makeDatabase(url);

      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });

      const pausing = db.transaction().execute(async (trx) => {
        await trx.updateTable('pages').set({monitoring_enabled: false}).where('id', '=', pageId).execute();
        await held;
      });

      try {
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
        const scheduling = new PostgresAuditRepository(second).addScheduled({
          pageId,
          url: `https://${randomUUID()}.test/x`,
          scheduledFor: '2026-08-17',
        });

        const outcome = await Promise.race([
          scheduling.then(() => 'completed' as const),
          new Promise<'blocked'>((resolve) => {
            setTimeout(() => {
              resolve('blocked');
            }, 250);
          }),
        ]);
        expect(outcome).toBe('blocked');

        release();
        await pausing;

        expect(await scheduling).toBeNull();
        expect(await db.selectFrom('audits').select('id').where('page_id', '=', pageId).execute()).toEqual([]);
      } finally {
        release();
        await pausing;
        await second.destroy();
      }
    });

    it('still schedules one for a page that is monitored', async () => {
      const pageId = await makePage();

      const audit = await sut.addScheduled({
        pageId,
        url: `https://${randomUUID()}.test/x`,
        scheduledFor: '2026-08-17',
      });

      expect(audit).not.toBeNull();
      expect(audit?.scheduledFor).not.toBeNull();
    });
  });

  describe('deleteIfQueued', () => {
    it('removes an audit that is still queued', async () => {
      const audit = await sut.add({url: `https://${randomUUID()}.test/x`, pageId: null});

      await sut.deleteIfQueued(audit.id);

      expect(await sut.loadById(audit.id)).toBeNull();
    });

    it('refuses to remove an audit that is no longer queued', async () => {
      for (const advance of ['running', 'done', 'failed'] as const) {
        const audit = await sut.add({url: `https://${randomUUID()}.test/x`, pageId: null});
        const claimedAt = await sut.claimForRun(audit.id);
        if (claimedAt === null) {
          throw new Error('fixture failed to claim');
        }

        if (advance === 'done') {
          await complete(audit.id, claimedAt, {
            score: 100,
            countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
            axeVersion: '4.12.1',
            durationMs: 1,
            settled: true,
          });
        } else if (advance === 'failed') {
          await sut.markFailed(audit.id, claimedAt, 'Could not resolve that domain');
        }

        await sut.deleteIfQueued(audit.id);

        expect(await sut.loadById(audit.id)).not.toBeNull();
      }
    });

    it('is silent about an id that does not exist', async () => {
      await expect(sut.deleteIfQueued('999999999')).resolves.toBeUndefined();
    });
  });
});

describe('claimLeaseFor', () => {
  const MAX_JOB_TIMEOUT_MS = 600_000;
  const UNWIND_GRACE_MS = 15_000;

  it('outlasts the longest an attempt can possibly occupy', () => {
    for (const jobTimeoutMs of [45_000, 120_000, MAX_JOB_TIMEOUT_MS]) {
      const longestPossibleAttempt = jobTimeoutMs + UNWIND_GRACE_MS;

      expect(claimLeaseFor(jobTimeoutMs, UNWIND_GRACE_MS)).toBeGreaterThan(longestPossibleAttempt);
    }
  });

  it('grows with the configured budget rather than staying fixed', () => {
    expect(claimLeaseFor(600_000, UNWIND_GRACE_MS)).toBeGreaterThan(claimLeaseFor(45_000, UNWIND_GRACE_MS));
  });
});
