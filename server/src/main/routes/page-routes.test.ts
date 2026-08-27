import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import type {Express} from 'express';
import type {Kysely} from 'kysely';
import {setupApp} from '../config/app.js';
import {connectDatabase, disconnectDatabase, getDatabase} from '../config/database.js';
import {makeTestAppDependencies, type TestAppDependencies} from '../test/test-app-dependencies.js';
import {PAGE_LIMIT} from '../config/page-limits.js';
import {RATE_LIMITS} from '../config/rate-limits.js';
import type {Database} from '../../infra/db/postgres/database.js';
import {PostgresPageRepository} from '../../infra/db/postgres/page/postgres-page-repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const password = 'correct horse battery staple';

describe('page routes', () => {
  let app: Express;
  let db: Kysely<Database>;
  let dependencies: TestAppDependencies;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) {
      throw new Error('DATABASE_URL not set by globalSetup');
    }
    connectDatabase(url);
    db = getDatabase();
    dependencies = makeTestAppDependencies();
    app = setupApp(dependencies);
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  let ipSeq = 0;
  const uniqueIp = (): string => {
    ipSeq += 1;
    return `172.20.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
  };

  const firstSetCookie = (response: request.Response): string => {
    const header: unknown = response.headers['set-cookie'];
    if (!Array.isArray(header) || typeof header[0] !== 'string') {
      throw new Error('expected a set-cookie header');
    }
    return header[0];
  };

  const signUp = async (target: Express = app): Promise<string> => {
    const response = await request(target)
      .post('/api/signup')
      .set('x-forwarded-for', uniqueIp())
      .send({email: `${randomUUID()}@pages.test`, password})
      .expect(201);
    return firstSetCookie(response);
  };

  const auditableUrl = (): string => `http://93.184.216.34/${randomUUID()}`;

  const accountIdFor = async (cookie: string): Promise<string> => {
    const sessionId = cookie.split(';')[0]?.split('=')[1];
    if (sessionId === undefined) {
      throw new Error('expected a session cookie');
    }
    const session = await db
      .selectFrom('sessions')
      .select('user_id')
      .where('id', '=', sessionId)
      .executeTakeFirstOrThrow();
    return session.user_id;
  };

  const seedPage = async (cookie: string): Promise<{pageId: string; url: string}> => {
    const url = auditableUrl();
    const added = await new PostgresPageRepository(db).add({
      userId: await accountIdFor(cookie),
      domain: '93.184.216.34',
      url,
      limit: 100,
    });
    if (added.outcome !== 'added') {
      throw new Error(`expected a page, got ${added.outcome}`);
    }
    return {pageId: added.page.id, url};
  };

  const addPage = async (cookie: string, url: string): Promise<request.Response> =>
    await request(app).post('/api/pages').set('x-forwarded-for', uniqueIp()).set('cookie', cookie).send({url});

  describe('authentication', () => {
    it('answers 401 on every route without a session', async () => {
      const responses = await Promise.all([
        request(app).post('/api/pages').set('x-forwarded-for', uniqueIp()).send({url: auditableUrl()}),
        request(app).get('/api/pages').set('x-forwarded-for', uniqueIp()),
        request(app).patch('/api/pages/1').set('x-forwarded-for', uniqueIp()).send({monitoringEnabled: false}),
        request(app).delete('/api/pages/1').set('x-forwarded-for', uniqueIp()),
        request(app).get('/api/pages/1/history').set('x-forwarded-for', uniqueIp()),
      ]);

      expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
    });

    it('meters an unauthenticated caller rather than letting it drive session lookups', async () => {
      const ip = '172.21.0.2';
      const probe = async (): Promise<number> =>
        (await request(app).get('/api/pages').set('x-forwarded-for', ip)).status;

      const statuses: number[] = [];
      for (let index = 0; index <= RATE_LIMITS.pageRead.capacity; index++) {
        statuses.push(await probe());
      }

      expect(statuses.at(0)).toBe(401);
      expect(statuses.at(-1)).toBe(429);
    });
  });

  describe('POST /api/pages', () => {
    it('creates the page and starts its first audit', async () => {
      const cookie = await signUp();
      const url = auditableUrl();

      const response = await addPage(cookie, url);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(String),
        url,
        monitoringEnabled: true,
        createdAt: expect.any(String),
        firstAuditId: expect.stringMatching(UUID),
      });

      const audit = await db
        .selectFrom('audits')
        .select(['status', 'page_id'])
        .where('public_uuid', '=', response.body.firstAuditId as string)
        .executeTakeFirstOrThrow();
      expect(audit.status).toBe('queued');
      expect(audit.page_id).toBe(response.body.id);
      const queued = await db
        .selectFrom('audits')
        .select('id')
        .where('public_uuid', '=', response.body.firstAuditId as string)
        .executeTakeFirstOrThrow();
      expect(dependencies.auditQueue.jobs.get(queued.id)).toEqual({auditId: queued.id});
    });

    it('answers with exactly the documented fields and nothing else', async () => {
      const cookie = await signUp();

      const response = await addPage(cookie, auditableUrl());

      expect(Object.keys(response.body as Record<string, unknown>).toSorted()).toEqual([
        'createdAt',
        'firstAuditId',
        'id',
        'monitoringEnabled',
        'url',
      ]);
    });

    it('normalises the url before storing it, so a fragment is not a second page', async () => {
      const cookie = await signUp();
      const path = randomUUID();

      const first = await addPage(cookie, `http://93.184.216.34/${path}`);
      const again = await addPage(cookie, `http://93.184.216.34/${path}#pricing`);

      expect(first.status).toBe(201);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('page_already_tracked');
    });

    it('creates neither a second site nor a second page for a duplicate submission', async () => {
      const cookie = await signUp();
      const url = auditableUrl();

      const first = await addPage(cookie, url);
      const second = await addPage(cookie, url);

      expect(first.status).toBe(201);
      expect(second.status).toBe(409);

      const page = await db
        .selectFrom('pages')
        .select('site_id')
        .where('id', '=', first.body.id as string)
        .executeTakeFirstOrThrow();
      const sites = await db.selectFrom('sites').select('id').where('id', '=', page.site_id).execute();
      expect(sites).toHaveLength(1);

      const audits = await db
        .selectFrom('audits')
        .select('id')
        .where('page_id', '=', first.body.id as string)
        .execute();
      expect(audits).toHaveLength(1);
    });

    it("groups a second page on the same host under the account's existing site", async () => {
      const cookie = await signUp();

      const first = await addPage(cookie, auditableUrl());
      const second = await addPage(cookie, auditableUrl());

      const rows = await db
        .selectFrom('pages')
        .select('site_id')
        .where('id', 'in', [first.body.id as string, second.body.id as string])
        .execute();

      expect(new Set(rows.map((row) => row.site_id)).size).toBe(1);
    });

    it('refuses the page past the account cap, with a body the UI can render', async () => {
      const cookie = await signUp();
      const pages = new PostgresPageRepository(db);
      const userId = await accountIdFor(cookie);
      for (let index = 0; index < PAGE_LIMIT; index++) {
        await pages.add({
          userId,
          domain: '93.184.216.34',
          url: `http://93.184.216.34/seed-${index}`,
          limit: 100,
        });
      }

      const refused = await addPage(cookie, auditableUrl());

      expect(refused.status).toBe(409);
      expect(refused.body).toEqual({
        code: 'page_limit_reached',
        limit: PAGE_LIMIT,
        error: expect.stringContaining(String(PAGE_LIMIT)),
      });
    });

    it('rejects an unsafe url without creating anything', async () => {
      const cookie = await signUp();

      const loopback = await addPage(cookie, 'http://127.0.0.1/admin');
      expect(loopback.status).toBe(400);
      expect(loopback.body.error).toBe("That address can't be audited");

      expect((await addPage(cookie, 'ftp://example.com/')).status).toBe(400);
      expect((await addPage(cookie, 'not a url')).status).toBe(400);
      expect((await addPage(cookie, '')).status).toBe(400);

      const listed = await request(app).get('/api/pages').set('x-forwarded-for', uniqueIp()).set('cookie', cookie);
      expect(listed.body.pages).toEqual([]);
    });

    it('rate limits by address once the burst is spent', async () => {
      const cookie = await signUp();
      const ip = '172.21.0.1';
      const submit = async (): Promise<number> =>
        (
          await request(app)
            .post('/api/pages')
            .set('x-forwarded-for', ip)
            .set('cookie', cookie)
            .send({url: 'not a url'})
        ).status;

      for (let index = 0; index < RATE_LIMITS.pageAdd.capacity; index++) {
        expect(await submit()).toBe(400);
      }

      expect(await submit()).toBe(429);
    });
  });

  describe('GET /api/pages', () => {
    it('does not enqueue while reading or updating a repository-seeded page', async () => {
      const isolatedDependencies = makeTestAppDependencies();
      let enqueueCalls = 0;
      isolatedDependencies.auditQueue.enqueueOnce = (): Promise<void> => {
        enqueueCalls += 1;
        return Promise.reject(new Error('non-POST page routes must not enqueue'));
      };
      const isolatedApp = setupApp(isolatedDependencies);
      const cookie = await signUp(isolatedApp);
      const {pageId} = await seedPage(cookie);

      const listed = await request(isolatedApp)
        .get('/api/pages')
        .set('x-forwarded-for', uniqueIp())
        .set('cookie', cookie);
      const patched = await request(isolatedApp)
        .patch(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp())
        .set('cookie', cookie)
        .send({monitoringEnabled: false});

      expect(listed.status).toBe(200);
      expect(patched.status).toBe(200);
      expect(enqueueCalls).toBe(0);
    });

    it('answers the empty state with the cap, not just an empty list', async () => {
      const cookie = await signUp();

      const response = await request(app).get('/api/pages').set('x-forwarded-for', uniqueIp()).set('cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({pages: [], limit: PAGE_LIMIT, used: 0});
    });

    it('serves the dashboard row: score, previous score, sparkline and status', async () => {
      const cookie = await signUp();
      const {pageId, url} = await seedPage(cookie);

      for (const score of [70, 82, 91]) {
        await db
          .insertInto('audits')
          .values({
            page_id: pageId,
            url,
            status: 'done',
            score,
          })
          .execute();
      }
      await db
        .insertInto('audits')
        .values({
          page_id: pageId,
          url,
          status: 'failed',
          error: 'Navigation timed out',
        })
        .execute();

      const response = await request(app).get('/api/pages').set('x-forwarded-for', uniqueIp()).set('cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body.used).toBe(1);
      const [page] = response.body.pages as Record<string, unknown>[];
      expect(page).toMatchObject({
        id: pageId,
        domain: '93.184.216.34',
        monitoringEnabled: true,
        score: 91,
        previousScore: 82,
        latestAudit: {status: 'failed', score: null, error: 'Navigation timed out'},
      });
      expect(page?.history).toEqual([
        {score: 70, at: expect.any(String)},
        {score: 82, at: expect.any(String)},
        {score: 91, at: expect.any(String)},
      ]);
    });

    it("never returns another account's pages", async () => {
      const [alice, bob] = await Promise.all([signUp(), signUp()]);
      await seedPage(alice);

      const response = await request(app).get('/api/pages').set('x-forwarded-for', uniqueIp()).set('cookie', bob);

      expect(response.body).toEqual({pages: [], limit: PAGE_LIMIT, used: 0});
    });
  });

  describe('PATCH /api/pages/:id', () => {
    it('pauses and resumes monitoring without losing history', async () => {
      const cookie = await signUp();
      const {pageId} = await seedPage(cookie);

      const paused = await request(app)
        .patch(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp())
        .set('cookie', cookie)
        .send({monitoringEnabled: false});

      expect(paused.status).toBe(200);
      expect(paused.body).toMatchObject({id: pageId, monitoringEnabled: false});

      const resumed = await request(app)
        .patch(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp())
        .set('cookie', cookie)
        .send({monitoringEnabled: true});
      expect(resumed.body.monitoringEnabled).toBe(true);

      const audits = await db.selectFrom('audits').select('id').where('page_id', '=', pageId).execute();
      expect(audits).toHaveLength(1);
    });

    it('rejects a body that does not carry a boolean', async () => {
      const cookie = await signUp();
      const {pageId} = await seedPage(cookie);

      const coerced = await request(app)
        .patch(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp())
        .set('cookie', cookie)
        .send({monitoringEnabled: 'false'});

      expect(coerced.status).toBe(400);

      const row = await db
        .selectFrom('pages')
        .select('monitoring_enabled')
        .where('id', '=', pageId)
        .executeTakeFirstOrThrow();
      expect(row.monitoring_enabled).toBe(true);
    });
  });

  describe('DELETE /api/pages/:id', () => {
    it('removes the page and its whole audit history', async () => {
      const cookie = await signUp();
      const {pageId} = await seedPage(cookie);

      const response = await request(app)
        .delete(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp())
        .set('cookie', cookie);

      expect(response.status).toBe(204);
      expect(await db.selectFrom('pages').select('id').where('id', '=', pageId).executeTakeFirst()).toBeUndefined();
      expect(
        await db.selectFrom('audits').select('id').where('page_id', '=', pageId).executeTakeFirst(),
      ).toBeUndefined();
    });

    it('answers 404 for a second delete rather than pretending it worked', async () => {
      const cookie = await signUp();
      const {pageId} = await seedPage(cookie);

      await request(app)
        .delete(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp())
        .set('cookie', cookie)
        .expect(204);

      const again = await request(app)
        .delete(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp())
        .set('cookie', cookie);
      expect(again.status).toBe(404);
    });
  });

  describe('GET /api/pages/:id/history', () => {
    const historyOf = async (cookie: string, pageId: string, query = ''): Promise<request.Response> =>
      await request(app)
        .get(`/api/pages/${pageId}/history${query}`)
        .set('x-forwarded-for', uniqueIp())
        .set('cookie', cookie);

    const pageWithTrend = async (cookie: string): Promise<string> => {
      const {pageId, url} = await seedPage(cookie);

      for (const [days, score] of [
        [5, 70],
        [3, 82],
        [1, 91],
      ] as const) {
        await db
          .insertInto('audits')
          .values({
            page_id: pageId,
            url,
            status: 'done',
            score,
            created_at: new Date(Date.now() - days * 86_400_000),
          })
          .execute();
      }
      await db
        .insertInto('audits')
        .values({
          page_id: pageId,
          url,
          status: 'failed',
          error: 'Navigation timed out',
          created_at: new Date(Date.now() - 12 * 3_600_000),
        })
        .execute();

      return pageId;
    };

    it('returns the window oldest first, with failures kept as scoreless points', async () => {
      const cookie = await signUp();
      const pageId = await pageWithTrend(cookie);

      const response = await historyOf(cookie, pageId);

      expect(response.status).toBe(200);
      expect(response.body.pageId).toBe(pageId);
      expect(response.body.days).toBe(90);

      const points = response.body.points as Record<string, unknown>[];
      expect(points.map((point) => point.score)).toEqual([70, 82, 91, null, null]);
      expect(points.map((point) => point.status)).toEqual(['done', 'done', 'done', 'failed', 'queued']);
      expect(points[3]).toMatchObject({
        auditId: expect.stringMatching(UUID),
        createdAt: expect.any(String),
        countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
        axeVersion: null,
      });
    });

    it('honours a narrower window', async () => {
      const cookie = await signUp();
      const pageId = await pageWithTrend(cookie);

      const response = await historyOf(cookie, pageId, '?days=2');

      expect(response.body.days).toBe(2);
      expect((response.body.points as unknown[]).map((point) => (point as {score: number | null}).score)).toEqual([
        91,
        null,
        null,
      ]);
    });

    it('clamps an oversized window instead of scanning the table, and says so', async () => {
      const cookie = await signUp();
      const pageId = await pageWithTrend(cookie);

      const response = await historyOf(cookie, pageId, '?days=100000');

      expect(response.status).toBe(200);
      expect(response.body.days).toBe(365);
    });

    it('rejects a window that is not a positive integer', async () => {
      const cookie = await signUp();
      const pageId = await pageWithTrend(cookie);

      for (const query of ['?days=abc', '?days=0', '?days=-5', '?days=1.5', '?days=']) {
        expect((await historyOf(cookie, pageId, query)).status).toBe(400);
      }
    });

    it('lets a browser cache it privately, keyed on the session', async () => {
      const cookie = await signUp();
      const pageId = await pageWithTrend(cookie);

      const response = await historyOf(cookie, pageId);

      expect(response.headers['cache-control']).toBe('private, max-age=60');
      expect(response.headers.vary).toContain('Cookie');
      expect(response.headers.vary?.toLowerCase()).toContain('origin');
    });

    it('returns an empty point list rather than 404 for a page with no audits in range', async () => {
      const cookie = await signUp();
      const {pageId} = await seedPage(cookie);
      await db.deleteFrom('audits').where('page_id', '=', pageId).execute();

      const response = await historyOf(cookie, pageId, '?days=1');

      expect(response.status).toBe(200);
      expect(response.body.points).toEqual([]);
    });
  });

  describe('cross-account access', () => {
    it('answers 404, never 403, on every route that names a page', async () => {
      const [alice, bob] = await Promise.all([signUp(), signUp()]);
      const {pageId} = await seedPage(alice);

      const patched = await request(app)
        .patch(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp())
        .set('cookie', bob)
        .send({monitoringEnabled: false});
      const deleted = await request(app)
        .delete(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp())
        .set('cookie', bob);
      const history = await request(app)
        .get(`/api/pages/${pageId}/history`)
        .set('x-forwarded-for', uniqueIp())
        .set('cookie', bob);

      expect([patched.status, deleted.status, history.status]).toEqual([404, 404, 404]);

      const row = await db
        .selectFrom('pages')
        .select('monitoring_enabled')
        .where('id', '=', pageId)
        .executeTakeFirstOrThrow();
      expect(row.monitoring_enabled).toBe(true);
    });

    describe('POST /api/pages/:id/audits', () => {
      const settledPage = async (cookie: string): Promise<string> => {
        const {pageId} = await seedPage(cookie);
        await db.updateTable('audits').set({status: 'done', score: 90}).where('page_id', '=', pageId).execute();
        return pageId;
      };

      const askForAudit = async (cookie: string, pageId: string): Promise<request.Response> =>
        await request(app).post(`/api/pages/${pageId}/audits`).set('x-forwarded-for', uniqueIp()).set('cookie', cookie);

      it('queues an audit attached to the page, so it lands in that page history', async () => {
        const cookie = await signUp();
        const pageId = await settledPage(cookie);

        const response = await askForAudit(cookie, pageId);

        expect(response.status).toBe(202);
        expect(response.body).toMatchObject({auditId: expect.stringMatching(UUID) as unknown});

        const history = await request(app)
          .get(`/api/pages/${pageId}/history`)
          .set('x-forwarded-for', uniqueIp())
          .set('cookie', cookie)
          .expect(200);

        expect(history.body.points).toContainEqual(
          expect.objectContaining({auditId: response.body.auditId, status: 'queued'}),
        );
      });

      it('refuses a second audit the same day, and says when the next one is available', async () => {
        const cookie = await signUp();
        const pageId = await settledPage(cookie);
        expect((await askForAudit(cookie, pageId)).status).toBe(202);
        await db.updateTable('audits').set({status: 'done'}).where('page_id', '=', pageId).execute();

        const response = await askForAudit(cookie, pageId);

        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({code: 'on_demand_audit_spent'});
        expect(Date.parse(response.body.resetAt)).toBeGreaterThan(Date.now());
      });

      it('refuses while that page is already being audited', async () => {
        const cookie = await signUp();
        const {pageId} = await seedPage(cookie);

        const response = await askForAudit(cookie, pageId);

        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({code: 'audit_in_flight'});
      });

      it("answers 404 for another account's page, the same as one that does not exist", async () => {
        const mine = await signUp();
        const theirs = await signUp();
        const pageId = await settledPage(theirs);

        expect((await askForAudit(mine, pageId)).status).toBe(404);
        expect((await askForAudit(mine, '999999999999')).status).toBe(404);
      });

      it('requires a session', async () => {
        const cookie = await signUp();
        const pageId = await settledPage(cookie);

        const response = await request(app).post(`/api/pages/${pageId}/audits`).set('x-forwarded-for', uniqueIp());

        expect(response.status).toBe(401);
      });
    });

    it('answers the same 404 for an id that could never be a row', async () => {
      const cookie = await signUp();

      const responses = await Promise.all([
        request(app).delete('/api/pages/not-a-number').set('x-forwarded-for', uniqueIp()).set('cookie', cookie),
        request(app).delete('/api/pages/99999999999999999999').set('x-forwarded-for', uniqueIp()).set('cookie', cookie),
        request(app)
          .patch('/api/pages/not-a-number')
          .set('x-forwarded-for', uniqueIp())
          .set('cookie', cookie)
          .send({monitoringEnabled: false}),
        request(app).get('/api/pages/not-a-number/history').set('x-forwarded-for', uniqueIp()).set('cookie', cookie),
      ]);

      expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    });
  });
});
