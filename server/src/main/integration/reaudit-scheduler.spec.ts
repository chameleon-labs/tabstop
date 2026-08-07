import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {sql, type Kysely} from 'kysely';
import {DbRunScheduledReaudits} from '../../data/usecases/reaudit/db-run-scheduled-reaudits.js';
import {reauditDelayMs, utcDay, utcDayStart} from '../../domain/services/reaudit-schedule.js';
import {PostgresAuditRepository} from '../../infra/db/postgres/audit/postgres-audit-repository.js';
import type {Database} from '../../infra/db/postgres/database.js';
import {makeDatabase} from '../../infra/db/postgres/helpers/postgres-helper.js';
import {runMigrations} from '../../infra/db/postgres/migrations/migrator.js';
import {PostgresPageRepository} from '../../infra/db/postgres/page/postgres-page-repository.js';
import {BullMqAuditQueue} from '../../infra/queue/bullmq-job-queue.js';
import {makeQueue, type PayloadQueue} from '../../infra/queue/helpers/bullmq-helper.js';
import type {AuditJob} from '../../data/protocols/queue/audit-job-queue.js';

/**
 * #13's acceptance criteria with nothing faked below the usecase: real
 * Postgres, real Redis, real BullMQ.
 *
 * The unit specs cover the branches. What this proves is the part no mock can
 * - that the two idempotency layers actually compose against the real unique
 * index, and that the delay reaches the real queue.
 */
describe('daily re-audit scheduler', () => {
  let db: Kysely<Database>;
  let queue: PayloadQueue<AuditJob>;
  let sut: DbRunScheduledReaudits;

  /**
   * The real clock, not a fixed instant.
   *
   * A pinned date drifts away from the fixtures, which are written with the
   * database's `now()`, and the run reads both: a `NOW` two days ahead put
   * every earlier test's queued audit outside the in-flight grace window, so
   * pages that were mid-flight looked abandoned and were scheduled again.
   * The day arithmetic is asserted against `utcDay(NOW)` rather than a literal
   * for the same reason.
   */
  const NOW = new Date();
  const TOMORROW = new Date(NOW.getTime() + 86_400_000);
  // Smaller than the fixtures any one test creates, so the paging loop runs
  // for real rather than being one batch every time.
  const BATCH_SIZE = 2;
  const MAX_PAGES = 5000;
  const GRACE_MS = 12 * 60 * 60 * 1000;

  /**
   * Its OWN database, which no other spec in this suite needs.
   *
   * Everything else here shares one and stays out of the way by suffixing its
   * fixtures with a uuid. That does not work for this spec, because the thing
   * under test is deliberately global - the nightly run audits every monitored
   * page there is - so running it against the shared database inserts audits
   * into other spec files' pages while they are counting them. It was caught
   * that way round: a migration spec asserting two audits for two pages
   * intermittently found three.
   *
   * The isolation also makes the assertions exact. Against the shared
   * database, `auditsEnqueued` counts whatever pages another file created a
   * moment ago, so every count would have to be a lower bound.
   */
  const databaseName = `reaudit_${randomUUID().replaceAll('-', '')}`;

  const urlFor = (name: string): string => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) {
      throw new Error('DATABASE_URL not set by globalSetup');
    }
    const parsed = new URL(url);
    parsed.pathname = `/${name}`;
    return parsed.toString();
  };

  beforeAll(async () => {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl === undefined) {
      throw new Error('REDIS_URL not set by globalSetup');
    }

    const admin = makeDatabase(urlFor('postgres'));
    try {
      // Not parameterised, because an identifier cannot be: the name is one
      // this file generated from randomUUID, never anything from outside.
      await sql.raw(`create database ${databaseName}`).execute(admin);
    } finally {
      await admin.destroy();
    }

    db = makeDatabase(urlFor(databaseName));
    await runMigrations(db);

    // Its own queue name too, since Redis is shared and stays shared.
    queue = makeQueue<AuditJob>(`reaudit-spec-${randomUUID()}`, redisUrl);
    sut = new DbRunScheduledReaudits(
      new PostgresPageRepository(db),
      new PostgresAuditRepository(db),
      new PostgresAuditRepository(db),
      new BullMqAuditQueue(queue),
      BATCH_SIZE,
      MAX_PAGES,
      GRACE_MS,
    );
  });

  afterAll(async () => {
    await queue.close();
    await db.destroy();

    const admin = makeDatabase(urlFor('postgres'));
    try {
      await sql.raw(`drop database if exists ${databaseName}`).execute(admin);
    } finally {
      await admin.destroy();
    }
  });

  afterEach(async () => {
    await queue.drain(true);
  });

  /** A monitored page with no audits at all, on its own domain. */
  const monitoredPage = async (
    options: {monitoring?: boolean; domain?: string} = {},
  ): Promise<{pageId: string; domain: string}> => {
    const user = await db
      .insertInto('users')
      .values({email: `${randomUUID()}@reaudit.test`, password_digest: 'x'})
      .returning('id')
      .executeTakeFirstOrThrow();
    const domain = options.domain ?? `${randomUUID()}.test`;
    const site = await db
      .insertInto('sites')
      .values({user_id: user.id, domain})
      .returning('id')
      .executeTakeFirstOrThrow();
    const page = await db
      .insertInto('pages')
      .values({
        site_id: site.id,
        url: `https://${domain}/`,
        monitoring_enabled: options.monitoring ?? true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return {pageId: page.id, domain};
  };

  const auditsFor = async (pageId: string): Promise<{id: string; status: string}[]> =>
    await db.selectFrom('audits').select(['id', 'status']).where('page_id', '=', pageId).execute();

  it('creates one audit per monitored page and queues a job for each', async () => {
    const {pageId, domain} = await monitoredPage();

    const summary = await sut.run(NOW);

    expect(summary.scheduledFor).toBe(utcDay(NOW));
    const audits = await auditsFor(pageId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.status).toBe('queued');

    const job = await queue.getJob(`audit-${audits[0]?.id ?? ''}`);
    expect(job).toBeDefined();
    expect(job?.opts.delay).toBe(reauditDelayMs(domain, pageId));
  });

  it('produces no duplicates when the run fires twice', async () => {
    // The acceptance criterion, and the one that cannot be proved with a mock:
    // the second run's eligibility query excludes the page because the first
    // run left an audit in flight, and if that check ever stopped working the
    // unique index refuses the insert anyway.
    const {pageId} = await monitoredPage();

    await sut.run(NOW);
    const second = await sut.run(NOW);

    expect(await auditsFor(pageId)).toHaveLength(1);
    // Excluded by the query, so it never reached the constraint.
    expect(second.skippedDuplicate).toBe(0);
  });

  it('produces no duplicates even when the eligibility check cannot see the first run', async () => {
    // The layer underneath. Two runs overlapping in time both select the page
    // before either inserts - impossible to arrange by timing here, so the
    // state it produces is arranged directly: an audit already stamped with
    // today's `scheduled_for` that the eligibility query does not exclude. The
    // row is finished and dated before the day boundary, so neither clause
    // hides its page and the run reaches the insert exactly as the losing half
    // of an overlap would.
    //
    // `skippedDuplicate` can only come from the insert being refused, so this
    // asserts the constraint rather than the query. Mutation-checked by
    // dropping `unique` from the index: every spec in this file goes red,
    // because `on conflict (page_id, scheduled_for)` has no unique index left
    // to infer and Postgres rejects the statement outright. Worth knowing -
    // weakening that index does not silently permit duplicate audits, it stops
    // the scheduler working at all.
    const {pageId} = await monitoredPage();

    await sut.run(NOW);
    await db
      .updateTable('audits')
      .set({
        status: 'done',
        score: 90,
        created_at: new Date(utcDayStart(NOW).getTime() - 3_600_000),
      })
      .where('page_id', '=', pageId)
      .execute();

    const second = await sut.run(NOW);

    expect(await auditsFor(pageId)).toHaveLength(1);
    expect(second.skippedDuplicate).toBe(1);
    expect(second.auditsEnqueued).toBe(0);
  });

  it('audits the page again the next day', async () => {
    // The counterpart: the constraint must bound a day, not a page.
    const {pageId} = await monitoredPage();

    await sut.run(NOW);
    await db.updateTable('audits').set({status: 'done', score: 90}).where('page_id', '=', pageId).execute();
    await sut.run(TOMORROW);

    expect(await auditsFor(pageId)).toHaveLength(2);
  });

  it('leaves a paused page alone', async () => {
    const {pageId} = await monitoredPage({monitoring: false});

    await sut.run(NOW);

    expect(await auditsFor(pageId)).toHaveLength(0);
  });

  it('spreads several pages on one domain rather than firing them together', async () => {
    const domain = `${randomUUID()}.test`;
    const first = await monitoredPage({domain});
    const second = await db
      .insertInto('pages')
      .values({
        site_id: (
          await db.selectFrom('pages').select('site_id').where('id', '=', first.pageId).executeTakeFirstOrThrow()
        ).site_id,
        url: `https://${domain}/second`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await sut.run(NOW);

    const delays = await Promise.all(
      [first.pageId, second.id].map(async (pageId) => {
        const audits = await auditsFor(pageId);
        const job = await queue.getJob(`audit-${audits[0]?.id ?? ''}`);
        return job?.opts.delay;
      }),
    );

    // Each page's own slot, derived from its id - so this holds whether they
    // are scheduled together, in separate batches, or one of them on a retry.
    expect(delays).toEqual([reauditDelayMs(domain, first.pageId), reauditDelayMs(domain, second.id)]);
    expect(delays[0]).not.toBe(delays[1]);
  });
});
