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

  /** An account with two pages, so allowance specs can tell per-account from per-page. */
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
      // Null, so it cannot collide with the unique index the nightly dedupe
      // relies on - and so the run does not mistake it for its own work.
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
      // The bypass a flag on `audits` would leave open: deleting a page
      // cascades its audits, so an allowance counted through the account's
      // pages comes back by removing the page it was spent on. Audit one page,
      // delete it, audit the next - free, all day.
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
      // Out of the way, so the second attempt meets the allowance rather than
      // the in-flight check - which would pass for the wrong reason.
      await db.updateTable('audits').set({status: 'done'}).where('id', '=', first.audit.id).execute();

      expect(await ask(userId, pageIds[0]!)).toEqual({outcome: 'allowance-spent'});
    });

    it('counts the allowance across the account, not per page', async () => {
      // The property that makes this a plan entitlement rather than a
      // per-page cooldown: spending it on one page spends it for all of them.
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
      // The nightly run and the insert that adding a page performs both write
      // rows for this page today. Counting them would refuse somebody an
      // on-demand audit because their page was audited on schedule.
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
      // `releaseOnDemand` undoes an accepted request that never reached the
      // queue. A run that has begun is not that: a worker may have claimed it
      // between the enqueue failing and this call, because what the enqueue
      // lost was the reply and not necessarily the job. Deleting its row
      // mid-audit is how a worker completes an audit that no longer exists -
      // and refunding the allowance hands back a day for a run that is
      // happening anyway.
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
      // The other half of the same race. The account lock cannot help here:
      // the nightly run never takes it, so without the page lock both paths
      // pass their own checks and the page is audited twice in one night.
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

    it('waits behind the nightly run rather than inserting alongside it', async () => {
      // `addScheduled` locks the page row, so locking it here is what puts the
      // two in a queue. FOR NO KEY UPDATE for the reason the account lock test
      // records: the audits insert takes FOR KEY SHARE on this row by itself.
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
      // Deliberate, and the opposite of `addScheduled`, which refuses one.
      // Pausing says "stop fetching this nightly"; it does not say "refuse me
      // when I ask for it myself", and a control that went dead on a paused
      // page would read as a bug.
      const {userId, pageIds} = await makeAccount();
      await db.updateTable('pages').set({monitoring_enabled: false}).where('id', '=', pageIds[0]!).execute();

      expect((await ask(userId, pageIds[0]!)).outcome).toBe('added');
    });

    it('waits behind another request from the same account rather than counting past it', async () => {
      // Check-then-act is what this closes. A plain select takes no row lock
      // under READ COMMITTED, so two requests arriving together both count the
      // same zero on-demand audits, both insert, and an account entitled to one
      // run gets two Chromium runs. Reading the count in the same statement as
      // the insert would not close it either - only the lock does.
      //
      // Driven by holding the account row from outside rather than by racing
      // two calls, because a race that happens to serialise passes without the
      // lock and proves nothing. This blocks or it does not.
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
      // Signalled by the lock itself rather than by a timer: a sleep long
      // enough on this machine is not long enough on a loaded one, and the
      // failure it produces looks like the bug rather than like a slow test.
      const lockTaken = new Promise<void>((resolve) => {
        locked = resolve;
      });

      // FOR NO KEY UPDATE, not FOR UPDATE, and the distinction is what makes
      // this test discriminate. The ledger insert carries a foreign key to
      // `users`, so it takes FOR KEY SHARE on that row by itself - and FOR
      // UPDATE conflicts with that, which would block the request whether or
      // not `addOnDemand` locks anything. FOR NO KEY UPDATE conflicts with the
      // explicit FOR UPDATE and not with the foreign key's share, so what is
      // measured here is the lock this code takes rather than Postgres's.
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
      // The share page (#23) is addressed by public_uuid; the internal id must
      // never be what the world sees.
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
      // The second idempotency layer, and the reason it returns a value rather
      // than raising: the caller is looping over every monitored page, and a
      // 23505 would abort the transaction it is in and end the night there.
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
      // What `do nothing` buys over catching the error: a raised 23505 inside
      // a transaction aborts it, so every statement after the catch fails with
      // 25P02 and the only recovery is starting over.
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
      // The conflict target names the partial index, so it only ever sees
      // scheduled rows. A manual re-audit and the first audit an added page
      // gets both carry a null scheduled_for and are untouched by it.
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
      // Both, because either can be stranded: `queued` when an enqueue was
      // lost, `running` when the worker died holding it and its job is gone.
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
      // The cutoff is what keeps this off the healthy pending work that exists
      // on any night - a page waiting out its six-hour jitter delay is not
      // abandoned, it has not started.
      const recent = await inFlightAudit('queued', hoursAgo(1));

      expect(await staleIds(hoursAgo(12))).not.toContain(recent);
    });

    it('offers the oldest first, since that is where the abandoned ones are', async () => {
      // A row waiting on a busy queue gets older every night, but so does
      // everything ahead of it. The ones with no job at all never move, so
      // they sink to the front and a bounded scan still reaches them.
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

    // The cursor specs below assert only about the rows they created.
    // `loadStaleInFlight` is global by design - the reclaim pass reconciles
    // every unfinished audit there is - so every other spec file's in-flight
    // fixtures are in these results too, and one that asserted "mine is at the
    // head" would be asserting the suite's insertion order.
    //
    // They also take the cursor from a real load rather than building one, so
    // it carries whatever the repository actually emits. A hand-built cursor
    // is a second implementation of the thing under test, and this is exactly
    // where the two would disagree: the database's microseconds do not survive
    // a JavaScript Date.
    const cursorFor = async (auditId: string, olderThan: Date): Promise<StaleAudit> => {
      const rows = await sut.loadStaleInFlight(olderThan, 10_000, null);
      const found = rows.find((row) => row.auditId === auditId);
      if (found === undefined) {
        throw new Error(`${auditId} was not offered as a candidate`);
      }
      return found;
    };

    it('resumes after the cursor rather than serving the same batch again', async () => {
      // What stops the reclaim pass starving. Old candidates that are
      // legitimately pending never change their `created_at`, so they hold the
      // front of this list every night - without a cursor the orphan behind
      // them is never examined, and its page is excluded from re-audits for
      // good.
      const first = await inFlightAudit('queued', hoursAgo(500));
      const second = await inFlightAudit('queued', hoursAgo(499));

      const next = await staleIds(hoursAgo(400), 1000, await cursorFor(first, hoursAgo(400)));

      expect(next).toContain(second);
      expect(next).not.toContain(first);
    });

    it('does not serve a row again as its own successor', async () => {
      // Postgres keeps `timestamptz` to microseconds; a JavaScript Date holds
      // milliseconds. Carry the cursor as a Date and the value sent back is
      // smaller than the value stored, so `created_at > cursor` is true of the
      // row the cursor came FROM and it arrives again at the head of the next
      // batch. With a small batch that repeats forever, spending the run's
      // whole ceiling re-reading one row while the abandoned audits behind it
      // are never reached.
      const pageId = await makePage();
      // Microseconds a Date cannot hold, which is what makes the round trip
      // lossy. Every real row has them - `now()` is microsecond-resolution -
      // so this is the ordinary case rather than a contrived one.
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
      // `now()` is transaction time, so a fan-out's rows routinely share one.
      // A cursor comparing `created_at` alone would place all three on the
      // same side of it: resuming after the first would skip the other two
      // entirely, and one of them may be the orphan this pass exists to find.
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
      // The audit is a fact: the page was due, a run was created, nothing ran
      // it. A failure is what the dashboard should show and what the trend
      // chart should keep as a scoreless point - deleting it would make the
      // night look like it never happened.
      const auditId = await inFlightAudit('queued', hoursAgo(30));

      expect(await sut.markAbandoned(auditId, 'Abandoned')).toBe(true);

      const row = await sut.loadById(auditId);
      expect(row?.status).toBe('failed');
      expect(row?.error).toBe('Abandoned');
      expect(row?.completedAt).toBeInstanceOf(Date);
    });

    it('refuses to touch an audit that has already finished', async () => {
      // The fence. Between the run deciding a row is abandoned and this
      // statement, a worker may have picked it up after all - and overwriting
      // a real result with "abandoned" is worse than the stranded row this
      // exists to fix.
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

    // Terminal writes are fenced on the claim, so a test that finishes an
    // audit has to claim it first, exactly as the worker does.
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
      // Status alone is not exclusion: under READ COMMITTED the second
      // delivery re-checks the predicate after the first commits, and would
      // match the row the first just claimed. The lease is what excludes it.
      const id = await makeQueuedAudit();
      await sut.claimForRun(id);

      expect(await sut.claimForRun(id)).toBeNull();
    });

    it('reclaims an audit whose worker died and left the claim stale', async () => {
      const id = await makeQueuedAudit();
      await sut.claimForRun(id);

      // Age the claim rather than shortening the lease: a zero-length lease
      // compares two clock reads that can land in the same millisecond, which
      // makes the test flaky. Writing an old timestamp exercises the real
      // production lease and is deterministic.
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
      // Two deliveries can race: one finishes while the other is between
      // reading the row and claiming it. A plain update would put a completed
      // audit back into `running` and let a later run overwrite its result.
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
      // A paused attempt can resume after another worker reclaimed and finished
      // the audit. Unfenced, completion would overwrite the new owner's result
      // and markFailed would turn a success into a failure.
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
      // The regression this pins: a retryable failure writes no terminal
      // status, so without a release the row keeps a live lease and the retry
      // - which arrives seconds later - can never claim it.
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

      // The superseded attempt tries to release the claim it used to hold.
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
        // Not derived from the counts below: the repository writes whatever
        // score it is given, so this pins that the column round-trips it
        // rather than that it matches any particular formula.
        score: 42,
        countsByImpact: {minor: 1, moderate: 0, serious: 2, critical: 3},
        axeVersion: '4.12.1',
        durationMs: 1234,
        settled: false,
      });

      const row = await load(id);
      expect(row.status).toBe('done');
      expect(row.score).toBe(42);
      // jsonb reorders keys, so this must be compared structurally.
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
      // audits.score is a smallint with `check (score between 0 and 100)`. A
      // score outside it fails at completion time, a long way from whatever
      // produced it.
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
      // The worklist is read once at the top of a run that can last half an
      // hour. Pausing in between used to leave the insert unaware.
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
      // The interleaving the flag check alone does not survive: a plain select
      // takes no row lock, so the pause can update the page, find no audit to
      // delete because this one is still uncommitted, and commit - leaving a
      // paused page holding a queued audit.
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
        // Long enough for the update above to have taken the row lock.
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

        // And once it is let through, it reads the pause rather than its own
        // stale snapshot.
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
      // Presence, not the instant: a `date` column comes back at local
      // midnight, and nothing reads this value as a time.
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
      // This is the only delete on the repository. The status predicate is
      // what keeps it from ever removing a real audit - by the time anything
      // is running or finished, somebody is relying on it.
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
    // The regression this pins: a flat ten-minute lease looked generous
    // against the 45s default and was in fact SHORTER than the maximum the
    // environment schema permits (600s) plus its unwind grace (15s) - so a
    // valid configuration let a second worker reclaim a still-running audit.
    for (const jobTimeoutMs of [45_000, 120_000, MAX_JOB_TIMEOUT_MS]) {
      const longestPossibleAttempt = jobTimeoutMs + UNWIND_GRACE_MS;

      expect(claimLeaseFor(jobTimeoutMs, UNWIND_GRACE_MS)).toBeGreaterThan(longestPossibleAttempt);
    }
  });

  it('grows with the configured budget rather than staying fixed', () => {
    expect(claimLeaseFor(600_000, UNWIND_GRACE_MS)).toBeGreaterThan(claimLeaseFor(45_000, UNWIND_GRACE_MS));
  });
});
