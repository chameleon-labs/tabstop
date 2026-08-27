import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Kysely, PostgresDialect, sql} from 'kysely';
import {Pool} from 'pg';
import type {Database} from '../database.js';
import {makeDatabase} from '../helpers/postgres-helper.js';
import {HISTORY_POINTS, PostgresPageRepository} from './postgres-page-repository.js';
import {
  explainPlanText,
  explainRowsRead,
  makeRecordingDatabase,
  queryMatching,
  type IssuedQuery,
} from '../test/explain.js';
import type {DuePage} from '../../../../data/protocols/db/page/load-due-reaudits-repository.js';

const connectionUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (url === undefined) {
    throw new Error('DATABASE_URL not set by globalSetup');
  }
  return url;
};

const makeCountingDatabase = (sink: string[]): Kysely<Database> =>
  new Kysely<Database>({
    dialect: new PostgresDialect({pool: new Pool({connectionString: connectionUrl()})}),
    log: (event) => {
      if (event.level === 'query') {
        sink.push(event.query.sql);
      }
    },
  });

describe('PostgresPageRepository', () => {
  let db: Kysely<Database>;
  let sut: PostgresPageRepository;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) {
      throw new Error('DATABASE_URL not set by globalSetup');
    }
    db = makeDatabase(url);
    sut = new PostgresPageRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const makeUser = async (): Promise<string> => {
    const user = await db
      .insertInto('users')
      .values({email: `${randomUUID()}@page.test`, password_digest: 'x'})
      .returning('id')
      .executeTakeFirstOrThrow();
    return user.id;
  };

  const newDomain = (): string => `${randomUUID()}.test`;

  const addAudit = async (
    pageId: string,
    values: {status: 'queued' | 'running' | 'done' | 'failed'; score?: number},
  ): Promise<string> => {
    const audit = await db
      .insertInto('audits')
      .values({
        page_id: pageId,
        url: `https://${randomUUID()}.test/`,
        status: values.status,
        score: values.score ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return audit.id;
  };

  describe('add', () => {
    it('creates the site, the page and a queued first audit', async () => {
      const userId = await makeUser();
      const domain = newDomain();
      const url = `https://${domain}/pricing`;

      const result = await sut.add({userId, domain, url, limit: 10});

      expect(result.outcome).toBe('added');
      if (result.outcome !== 'added') {
        return;
      }
      expect(result.page).toEqual({
        id: expect.any(String),
        siteId: expect.any(String),
        url,
        monitoringEnabled: true,
        createdAt: expect.any(Date),
      });
      expect(result.firstAudit.status).toBe('queued');
      expect(result.firstAudit.pageId).toBe(result.page.id);
      expect(result.firstAudit.url).toBe(url);
    });

    it("reuses the account's existing site for a second page on the same host", async () => {
      const userId = await makeUser();
      const domain = newDomain();

      const first = await sut.add({userId, domain, url: `https://${domain}/a`, limit: 10});
      const second = await sut.add({userId, domain, url: `https://${domain}/b`, limit: 10});

      expect(first.outcome).toBe('added');
      expect(second.outcome).toBe('added');
      if (first.outcome !== 'added' || second.outcome !== 'added') {
        return;
      }
      expect(second.page.siteId).toBe(first.page.siteId);

      const sites = await db.selectFrom('sites').select('id').where('user_id', '=', userId).execute();
      expect(sites).toHaveLength(1);
    });

    it('gives two accounts their own site for the same host', async () => {
      const domain = newDomain();
      const [alice, bob] = await Promise.all([makeUser(), makeUser()]);

      const hers = await sut.add({userId: alice, domain, url: `https://${domain}/`, limit: 10});
      const his = await sut.add({userId: bob, domain, url: `https://${domain}/`, limit: 10});

      expect(hers.outcome).toBe('added');
      expect(his.outcome).toBe('added');
      if (hers.outcome !== 'added' || his.outcome !== 'added') {
        return;
      }
      expect(his.page.siteId).not.toBe(hers.page.siteId);
    });

    it('reports a duplicate rather than creating a second page or a second audit', async () => {
      const userId = await makeUser();
      const domain = newDomain();
      const url = `https://${domain}/`;

      await sut.add({userId, domain, url, limit: 10});
      const again = await sut.add({userId, domain, url, limit: 10});

      expect(again.outcome).toBe('duplicate');

      const pages = await db
        .selectFrom('pages')
        .innerJoin('sites', 'sites.id', 'pages.site_id')
        .select('pages.id')
        .where('sites.user_id', '=', userId)
        .execute();
      expect(pages).toHaveLength(1);

      const audits = await db
        .selectFrom('audits')
        .select('id')
        .where(
          'page_id',
          'in',
          pages.map((page) => page.id),
        )
        .execute();
      expect(audits).toHaveLength(1);
    });

    it('answers duplicate before limit-reached for an account already at the cap', async () => {
      const userId = await makeUser();
      const domain = newDomain();
      const url = `https://${domain}/0`;

      await sut.add({userId, domain, url, limit: 1});

      expect((await sut.add({userId, domain, url, limit: 1})).outcome).toBe('duplicate');
    });

    it('refuses the page that would exceed the limit', async () => {
      const userId = await makeUser();
      const domain = newDomain();

      await sut.add({userId, domain, url: `https://${domain}/a`, limit: 2});
      await sut.add({userId, domain, url: `https://${domain}/b`, limit: 2});
      const third = await sut.add({userId, domain, url: `https://${domain}/c`, limit: 2});

      expect(third.outcome).toBe('limit-reached');
    });

    it('keeps the limit exact when three adds race', async () => {
      const userId = await makeUser();
      const domain = newDomain();
      await sut.add({userId, domain, url: `https://${domain}/seed`, limit: 2});

      const results = await Promise.all([
        sut.add({userId, domain, url: `https://${domain}/a`, limit: 2}),
        sut.add({userId, domain, url: `https://${domain}/b`, limit: 2}),
        sut.add({userId, domain, url: `https://${domain}/c`, limit: 2}),
      ]);

      expect(results.filter((result) => result.outcome === 'added')).toHaveLength(1);
      expect(results.filter((result) => result.outcome === 'limit-reached')).toHaveLength(2);

      const pages = await db
        .selectFrom('pages')
        .innerJoin('sites', 'sites.id', 'pages.site_id')
        .select('pages.id')
        .where('sites.user_id', '=', userId)
        .execute();
      expect(pages).toHaveLength(2);
    });

    it('does not leave a site behind when the page is refused', async () => {
      const userId = await makeUser();
      const domain = newDomain();
      await sut.add({userId, domain, url: `https://${domain}/a`, limit: 1});

      const other = newDomain();
      expect((await sut.add({userId, domain: other, url: `https://${other}/`, limit: 1})).outcome).toBe(
        'limit-reached',
      );

      const sites = await db.selectFrom('sites').select('domain').where('user_id', '=', userId).execute();
      expect(sites.map((site) => site.domain)).toEqual([domain]);
    });
  });

  describe('loadSummariesForUser', () => {
    it('returns nothing for an account with no pages', async () => {
      expect(await sut.loadSummariesForUser(await makeUser())).toEqual([]);
    });

    it('returns each page with its host and its monitoring state, oldest first', async () => {
      const userId = await makeUser();
      const domain = newDomain();
      const first = await sut.add({userId, domain, url: `https://${domain}/a`, limit: 10});
      await sut.add({userId, domain, url: `https://${domain}/b`, limit: 10});
      if (first.outcome !== 'added') {
        throw new Error('expected the page to be added');
      }
      await sut.setMonitoringForUser(first.page.id, userId, false);

      const summaries = await sut.loadSummariesForUser(userId);

      expect(summaries.map((summary) => summary.page.url)).toEqual([`https://${domain}/a`, `https://${domain}/b`]);
      expect(summaries.map((summary) => summary.domain)).toEqual([domain, domain]);
      expect(summaries[0]?.page.monitoringEnabled).toBe(false);
      expect(summaries[1]?.page.monitoringEnabled).toBe(true);
    });

    it("never returns another account's pages", async () => {
      const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
      const domain = newDomain();
      await sut.add({userId: alice, domain, url: `https://${domain}/hers`, limit: 10});

      expect(await sut.loadSummariesForUser(bob)).toEqual([]);
    });

    it('reports the latest audit whatever its status, not the latest scored one', async () => {
      const userId = await makeUser();
      const domain = newDomain();
      const added = await sut.add({userId, domain, url: `https://${domain}/`, limit: 10});
      if (added.outcome !== 'added') {
        throw new Error('expected the page to be added');
      }

      await db.updateTable('audits').set({status: 'done', score: 80}).where('id', '=', added.firstAudit.id).execute();
      await addAudit(added.page.id, {status: 'failed'});

      const summaries = await sut.loadSummariesForUser(userId);

      expect(summaries[0]?.latestAudit?.status).toBe('failed');
      expect(summaries[0]?.history).toEqual([{score: 80, at: expect.any(Date)}]);
    });

    it('returns finished scores oldest first and caps the history at thirty points', async () => {
      const userId = await makeUser();
      const domain = newDomain();
      const added = await sut.add({userId, domain, url: `https://${domain}/`, limit: 10});
      if (added.outcome !== 'added') {
        throw new Error('expected the page to be added');
      }

      for (let score = 1; score <= 35; score++) {
        await addAudit(added.page.id, {status: 'done', score});
      }

      const summaries = await sut.loadSummariesForUser(userId);
      const history = summaries[0]?.history ?? [];

      expect(history).toHaveLength(30);
      expect(history.map((point) => point.score)).toEqual(Array.from({length: 30}, (_value, index) => index + 6));
    });

    it('caps the history PER PAGE rather than across the whole account', async () => {
      const userId = await makeUser();
      const domain = newDomain();
      const first = await sut.add({userId, domain, url: `https://${domain}/a`, limit: 10});
      const second = await sut.add({userId, domain, url: `https://${domain}/b`, limit: 10});
      if (first.outcome !== 'added' || second.outcome !== 'added') {
        throw new Error('expected both pages to be added');
      }

      for (let score = 1; score <= 31; score++) {
        await addAudit(first.page.id, {status: 'done', score});
      }
      await addAudit(second.page.id, {status: 'done', score: 42});

      const summaries = await sut.loadSummariesForUser(userId);

      expect(summaries[0]?.history).toHaveLength(30);
      expect(summaries[1]?.history.map((point) => point.score)).toEqual([42]);
    });

    it('reads about thirty audit rows for a page with two thousand', async () => {
      const issued: IssuedQuery[] = [];
      const recording = makeRecordingDatabase(issued);
      const repository = new PostgresPageRepository(recording);

      try {
        const userId = await makeUser();
        const domain = newDomain();
        const added = await sut.add({userId, domain, url: `https://${domain}/`, limit: 10});
        if (added.outcome !== 'added') {
          throw new Error('expected the page to be added');
        }

        const history = 2000;
        await sql`
          insert into audits (page_id, url, status, score, created_at)
          select ${added.page.id}::bigint, 'https://bulk.test/', 'done', (i % 100),
                 now() - (i || ' hours')::interval
          from generate_series(1, ${history}) i
        `.execute(db);
        await sql`analyze audits`.execute(db);

        issued.length = 0;
        expect((await repository.loadSummariesForUser(userId))[0]?.history).toHaveLength(30);

        const queries = [...issued];
        let rowsRead = 0;
        for (const query of queries) {
          rowsRead += await explainRowsRead(recording, query, 'audits');
        }

        expect(rowsRead).toBeGreaterThan(0);
        expect(rowsRead).toBeLessThan(HISTORY_POINTS * 2);
      } finally {
        await recording.destroy();
      }
    });

    it('costs the same number of queries for ten pages as for one', async () => {
      const counted: string[] = [];
      const counting = makeCountingDatabase(counted);
      const repository = new PostgresPageRepository(counting);

      try {
        const [thin, fat] = await Promise.all([makeUser(), makeUser()]);
        const domain = newDomain();
        await sut.add({userId: thin, domain, url: `https://${domain}/only`, limit: 10});
        for (let index = 0; index < 10; index++) {
          await sut.add({userId: fat, domain, url: `https://${domain}/${index}`, limit: 10});
        }

        counted.length = 0;
        await repository.loadSummariesForUser(thin);
        const forOnePage = counted.length;

        counted.length = 0;
        await repository.loadSummariesForUser(fat);
        const forTenPages = counted.length;

        expect(forOnePage).toBeGreaterThan(0);
        expect(forTenPages).toBe(forOnePage);
      } finally {
        await counting.destroy();
      }
    });

    it('leaves a page with no finished audit an empty history rather than a zero', async () => {
      const userId = await makeUser();
      const domain = newDomain();
      const added = await sut.add({userId, domain, url: `https://${domain}/`, limit: 10});
      if (added.outcome !== 'added') {
        throw new Error('expected the page to be added');
      }

      const summaries = await sut.loadSummariesForUser(userId);

      expect(summaries[0]?.history).toEqual([]);
      expect(summaries[0]?.latestAudit?.status).toBe('queued');
    });
  });

  describe('loadHistoryForUser', () => {
    const daysAgo = (days: number): Date => new Date(Date.now() - days * 86_400_000);

    const addAuditAt = async (
      pageId: string,
      at: Date,
      values: {status: 'done' | 'failed'; score?: number},
    ): Promise<void> => {
      await db
        .insertInto('audits')
        .values({
          page_id: pageId,
          url: `https://${randomUUID()}.test/`,
          status: values.status,
          score: values.score ?? null,
          created_at: at,
        })
        .execute();
    };

    const pageWithHistory = async (): Promise<{userId: string; pageId: string}> => {
      const userId = await makeUser();
      const domain = newDomain();
      const added = await sut.add({userId, domain, url: `https://${domain}/`, limit: 10});
      if (added.outcome !== 'added') {
        throw new Error('expected the page to be added');
      }
      await db.deleteFrom('audits').where('id', '=', added.firstAudit.id).execute();
      return {userId, pageId: added.page.id};
    };

    it('returns the page and its audits oldest first', async () => {
      const {userId, pageId} = await pageWithHistory();
      await addAuditAt(pageId, daysAgo(3), {status: 'done', score: 60});
      await addAuditAt(pageId, daysAgo(1), {status: 'done', score: 80});
      await addAuditAt(pageId, daysAgo(2), {status: 'done', score: 70});

      const history = await sut.loadHistoryForUser(pageId, userId, daysAgo(90));

      expect(history?.audits.map((audit) => audit.score)).toEqual([60, 70, 80]);
      expect(history?.page.id).toBe(pageId);
    });

    it('keeps failed audits as points, with a null score', async () => {
      const {userId, pageId} = await pageWithHistory();
      await addAuditAt(pageId, daysAgo(2), {status: 'done', score: 90});
      await addAuditAt(pageId, daysAgo(1), {status: 'failed'});

      const history = await sut.loadHistoryForUser(pageId, userId, daysAgo(90));

      expect(history?.audits.map((audit) => [audit.status, audit.score])).toEqual([
        ['done', 90],
        ['failed', null],
      ]);
    });

    it('excludes audits older than the window', async () => {
      const {userId, pageId} = await pageWithHistory();
      await addAuditAt(pageId, daysAgo(40), {status: 'done', score: 10});
      await addAuditAt(pageId, daysAgo(5), {status: 'done', score: 20});

      const history = await sut.loadHistoryForUser(pageId, userId, daysAgo(30));

      expect(history?.audits.map((audit) => audit.score)).toEqual([20]);
    });

    it('returns the page with no audits rather than null for a quiet window', async () => {
      const {userId, pageId} = await pageWithHistory();
      await addAuditAt(pageId, daysAgo(40), {status: 'done', score: 10});

      const history = await sut.loadHistoryForUser(pageId, userId, daysAgo(30));

      expect(history?.page.id).toBe(pageId);
      expect(history?.audits).toEqual([]);
    });

    it('returns null for a page belonging to somebody else', async () => {
      const {pageId} = await pageWithHistory();
      const bob = await makeUser();

      expect(await sut.loadHistoryForUser(pageId, bob, daysAgo(90))).toBeNull();
    });

    it('returns null for an id no bigint column could hold', async () => {
      const userId = await makeUser();

      expect(await sut.loadHistoryForUser('not-a-number', userId, daysAgo(90))).toBeNull();
      expect(await sut.loadHistoryForUser('99999999999999999999', userId, daysAgo(90))).toBeNull();
    });

    it('reads the audits through audits_page_created_idx', async () => {
      const issued: IssuedQuery[] = [];
      const recording = makeRecordingDatabase(issued);
      const repository = new PostgresPageRepository(recording);

      try {
        const {userId, pageId} = await pageWithHistory();
        for (let index = 0; index < 400; index++) {
          await addAuditAt(pageId, daysAgo(index % 80), {status: 'done', score: index % 100});
        }

        issued.length = 0;
        await repository.loadHistoryForUser(pageId, userId, daysAgo(30));

        const auditQuery = queryMatching(issued, /from "audits"/i);
        expect(auditQuery).toBeDefined();
        if (auditQuery === undefined) {
          return;
        }

        expect(await explainPlanText(recording, auditQuery)).toContain('audits_page_created_idx');
      } finally {
        await recording.destroy();
      }
    });
  });

  describe('loadDueForReaudit', () => {
    const MIDNIGHT_TODAY = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const NO_CAP = 10_000;

    const due = async (overrides: {limit?: number; after?: string | null; dayStart?: Date} = {}): Promise<DuePage[]> =>
      await sut.loadDueForReaudit({
        dayStart: overrides.dayStart ?? MIDNIGHT_TODAY,
        limit: overrides.limit ?? NO_CAP,
        after: overrides.after ?? null,
      });

    const NO_DAY_BOUNDARY = new Date('3000-01-01T00:00:00.000Z');

    const monitoredPage = async (
      options: {monitoring?: boolean} = {},
    ): Promise<{pageId: string; domain: string; url: string}> => {
      const userId = await makeUser();
      const domain = newDomain();
      const url = `https://${domain}/`;
      const site = await db
        .insertInto('sites')
        .values({user_id: userId, domain})
        .returning('id')
        .executeTakeFirstOrThrow();
      const page = await db
        .insertInto('pages')
        .values({site_id: site.id, url, monitoring_enabled: options.monitoring ?? true})
        .returning('id')
        .executeTakeFirstOrThrow();
      return {pageId: page.id, domain, url};
    };

    const dueIds = async (limit = NO_CAP): Promise<Set<string>> =>
      new Set((await due({limit})).map((page) => page.pageId));

    it('returns a monitored page with the domain its jitter keys on', async () => {
      const {pageId, domain, url} = await monitoredPage();

      expect(await due()).toContainEqual({pageId, url, domain});
    });

    it('skips a page whose monitoring is paused', async () => {
      const {pageId} = await monitoredPage({monitoring: false});

      expect(await dueIds()).not.toContain(pageId);
    });

    it('skips a page that already has an audit in flight', async () => {
      const queued = await monitoredPage();
      const running = await monitoredPage();
      await addAudit(queued.pageId, {status: 'queued'});
      await addAudit(running.pageId, {status: 'running'});

      const ids = await dueIds();

      expect(ids).not.toContain(queued.pageId);
      expect(ids).not.toContain(running.pageId);
    });

    it('keeps skipping a page with an unfinished audit however old it is', async () => {
      const {pageId} = await monitoredPage();
      await db
        .insertInto('audits')
        .values({
          page_id: pageId,
          url: `https://${randomUUID()}.test/`,
          status: 'queued',
          created_at: new Date(Date.now() - 90 * 86_400_000),
        })
        .execute();

      const ids = new Set((await due({dayStart: NO_DAY_BOUNDARY})).map((page) => page.pageId));

      expect(ids).not.toContain(pageId);
    });

    it('returns the page once that audit has finished, however it finished', async () => {
      const {pageId} = await monitoredPage();
      const audit = await db
        .insertInto('audits')
        .values({
          page_id: pageId,
          url: `https://${randomUUID()}.test/`,
          status: 'queued',
          created_at: new Date(Date.now() - 90 * 86_400_000),
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await db.updateTable('audits').set({status: 'failed', error: 'abandoned'}).where('id', '=', audit.id).execute();

      const ids = new Set((await due({dayStart: NO_DAY_BOUNDARY})).map((page) => page.pageId));

      expect(ids).toContain(pageId);
    });

    it('skips a page already audited today, however that audit came about', async () => {
      const {pageId} = await monitoredPage();
      await addAudit(pageId, {status: 'done', score: 90});

      expect(await dueIds()).not.toContain(pageId);
    });

    it('stands down tonight for a page audited on demand today', async () => {
      const {pageId} = await monitoredPage();
      await db
        .insertInto('audits')
        .values({
          page_id: pageId,
          url: `https://${randomUUID()}.test/`,
          status: 'done',
          score: 90,
        })
        .execute();

      expect(await dueIds()).not.toContain(pageId);
    });

    it('returns a page whose last audit was yesterday', async () => {
      const {pageId} = await monitoredPage();
      await db
        .insertInto('audits')
        .values({
          page_id: pageId,
          url: `https://${randomUUID()}.test/`,
          status: 'done',
          score: 90,
          created_at: new Date(MIDNIGHT_TODAY.getTime() - 3_600_000),
        })
        .execute();

      expect(await dueIds()).toContain(pageId);
    });

    it('returns a page whose last audit failed, rather than giving up on it', async () => {
      const {pageId} = await monitoredPage();
      await db
        .insertInto('audits')
        .values({
          page_id: pageId,
          url: `https://${randomUUID()}.test/`,
          status: 'failed',
          error: 'Navigation timed out',
          created_at: new Date(MIDNIGHT_TODAY.getTime() - 3_600_000),
        })
        .execute();

      expect(await dueIds()).toContain(pageId);
    });

    it('never returns more pages than the batch allows', async () => {
      await monitoredPage();
      await monitoredPage();

      expect(await due({limit: 1})).toHaveLength(1);
    });

    it('starts after the cursor, so the caller can page through', async () => {
      const first = await monitoredPage();
      const second = await monitoredPage();
      const ordered = [first.pageId, second.pageId].toSorted((left, right) => Number(BigInt(left) - BigInt(right)));
      const lower = ordered[0] ?? '';
      const higher = ordered[1] ?? '';

      const ids = new Set((await due({after: lower})).map((page) => page.pageId));

      expect(ids).toContain(higher);
      expect(ids).not.toContain(lower);
    });

    it('pages through the whole worklist without repeating or skipping a page', async () => {
      const mine = new Set(await Promise.all([0, 1, 2].map(async () => (await monitoredPage()).pageId)));

      const seen: string[] = [];
      let after: string | null = null;
      for (;;) {
        const batch = await due({limit: 1, after});
        const [page] = batch;
        if (page === undefined) {
          break;
        }
        if (mine.has(page.pageId)) {
          seen.push(page.pageId);
        }
        after = page.pageId;
      }

      expect(new Set(seen)).toEqual(mine);
      expect(seen).toHaveLength(mine.size);
    });
  });

  describe('setMonitoringForUser cancelling scheduled work', () => {
    const scheduleFor = async (pageId: string, url: string, day = '2026-08-17'): Promise<string> => {
      const audit = await db
        .insertInto('audits')
        .values({page_id: pageId, url, status: 'queued', scheduled_for: day})
        .returning('id')
        .executeTakeFirstOrThrow();
      return audit.id;
    };

    const queuedIds = async (pageId: string): Promise<string[]> =>
      (await db.selectFrom('audits').select('id').where('page_id', '=', pageId).execute()).map(({id}) => id);

    it('drops the audit a paused page is still waiting on', async () => {
      const userId = await makeUser();
      const domain = newDomain();
      const added = await sut.add({userId, domain, url: `https://${domain}/`, limit: 10});
      if (added.outcome !== 'added') {
        throw new Error('expected the page to be added');
      }
      await db.deleteFrom('audits').where('page_id', '=', added.page.id).execute();
      const scheduled = await scheduleFor(added.page.id, `https://${domain}/`);

      await sut.setMonitoringForUser(added.page.id, userId, false);

      expect(await queuedIds(added.page.id)).not.toContain(scheduled);
    });

    it("keeps the page's first audit, which runs at once rather than on a schedule", async () => {
      const userId = await makeUser();
      const domain = newDomain();
      const added = await sut.add({userId, domain, url: `https://${domain}/`, limit: 10});
      if (added.outcome !== 'added') {
        throw new Error('expected the page to be added');
      }

      await sut.setMonitoringForUser(added.page.id, userId, false);

      expect(await queuedIds(added.page.id)).toHaveLength(1);
    });

    it('cancels nothing when monitoring is being turned back on', async () => {
      const userId = await makeUser();
      const domain = newDomain();
      const added = await sut.add({userId, domain, url: `https://${domain}/`, limit: 10});
      if (added.outcome !== 'added') {
        throw new Error('expected the page to be added');
      }
      await db.deleteFrom('audits').where('page_id', '=', added.page.id).execute();
      const scheduled = await scheduleFor(added.page.id, `https://${domain}/`);

      await sut.setMonitoringForUser(added.page.id, userId, true);

      expect(await queuedIds(added.page.id)).toContain(scheduled);
    });

    it("never reaches another account's scheduled audits", async () => {
      const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
      const domain = newDomain();
      const hers = await sut.add({userId: alice, domain, url: `https://${domain}/`, limit: 10});
      if (hers.outcome !== 'added') {
        throw new Error('expected the page to be added');
      }
      await db.deleteFrom('audits').where('page_id', '=', hers.page.id).execute();
      const scheduled = await scheduleFor(hers.page.id, `https://${domain}/`);

      expect(await sut.setMonitoringForUser(hers.page.id, bob, false)).toBeNull();
      expect(await queuedIds(hers.page.id)).toContain(scheduled);
    });
  });

  describe('setMonitoringForUser', () => {
    it("pauses and resumes without touching the page's history", async () => {
      const userId = await makeUser();
      const domain = newDomain();
      const added = await sut.add({userId, domain, url: `https://${domain}/`, limit: 10});
      if (added.outcome !== 'added') {
        throw new Error('expected the page to be added');
      }

      const paused = await sut.setMonitoringForUser(added.page.id, userId, false);
      expect(paused?.monitoringEnabled).toBe(false);

      const resumed = await sut.setMonitoringForUser(added.page.id, userId, true);
      expect(resumed?.monitoringEnabled).toBe(true);

      const audits = await db.selectFrom('audits').select('id').where('page_id', '=', added.page.id).execute();
      expect(audits).toHaveLength(1);
    });

    it('returns null for a page belonging to somebody else, and changes nothing', async () => {
      const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
      const domain = newDomain();
      const hers = await sut.add({userId: alice, domain, url: `https://${domain}/`, limit: 10});
      if (hers.outcome !== 'added') {
        throw new Error('expected the page to be added');
      }

      expect(await sut.setMonitoringForUser(hers.page.id, bob, false)).toBeNull();

      const row = await db
        .selectFrom('pages')
        .select('monitoring_enabled')
        .where('id', '=', hers.page.id)
        .executeTakeFirstOrThrow();
      expect(row.monitoring_enabled).toBe(true);
    });

    it('returns null for an id no bigint column could hold', async () => {
      const userId = await makeUser();

      expect(await sut.setMonitoringForUser('not-a-number', userId, false)).toBeNull();
      expect(await sut.setMonitoringForUser('99999999999999999999', userId, false)).toBeNull();
      expect(await sut.setMonitoringForUser('', userId, false)).toBeNull();
    });
  });

  describe('deleteForUser', () => {
    it('removes the page and cascades its audits, violations and alert events', async () => {
      const userId = await makeUser();
      const domain = newDomain();
      const added = await sut.add({userId, domain, url: `https://${domain}/`, limit: 10});
      if (added.outcome !== 'added') {
        throw new Error('expected the page to be added');
      }

      const auditId = added.firstAudit.id;
      await db
        .insertInto('violations')
        .values({
          audit_id: auditId,
          rule_id: 'image-alt',
          impact: 'critical',
          description: 'x',
          help_url: 'https://example.test',
          nodes: JSON.stringify([]),
        })
        .execute();
      await db
        .insertInto('alert_events')
        .values({
          page_id: added.page.id,
          audit_id: auditId,
          kind: 'score_drop',
        })
        .execute();

      expect(await sut.deleteForUser(added.page.id, userId)).toBe(true);

      expect(
        await db.selectFrom('pages').select('id').where('id', '=', added.page.id).executeTakeFirst(),
      ).toBeUndefined();
      expect(await db.selectFrom('audits').select('id').where('id', '=', auditId).executeTakeFirst()).toBeUndefined();
      expect(
        await db.selectFrom('violations').select('id').where('audit_id', '=', auditId).executeTakeFirst(),
      ).toBeUndefined();
      expect(
        await db.selectFrom('alert_events').select('id').where('audit_id', '=', auditId).executeTakeFirst(),
      ).toBeUndefined();
    });

    it("leaves the account's site behind for its other pages", async () => {
      const userId = await makeUser();
      const domain = newDomain();
      const first = await sut.add({userId, domain, url: `https://${domain}/a`, limit: 10});
      await sut.add({userId, domain, url: `https://${domain}/b`, limit: 10});
      if (first.outcome !== 'added') {
        throw new Error('expected the page to be added');
      }

      await sut.deleteForUser(first.page.id, userId);

      const remaining = await sut.loadSummariesForUser(userId);
      expect(remaining.map((summary) => summary.page.url)).toEqual([`https://${domain}/b`]);
    });

    it('returns false for a page belonging to somebody else, and deletes nothing', async () => {
      const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
      const domain = newDomain();
      const hers = await sut.add({userId: alice, domain, url: `https://${domain}/`, limit: 10});
      if (hers.outcome !== 'added') {
        throw new Error('expected the page to be added');
      }

      expect(await sut.deleteForUser(hers.page.id, bob)).toBe(false);

      expect(await db.selectFrom('pages').select('id').where('id', '=', hers.page.id).executeTakeFirst()).toBeDefined();
    });

    it('returns false for an id no bigint column could hold', async () => {
      expect(await sut.deleteForUser('not-a-number', await makeUser())).toBe(false);
    });
  });
});
