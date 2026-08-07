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

  /**
   * A fresh client address per request, out of a block no other spec file
   * uses.
   *
   * Two separate hazards, and the second one cost a morning. Within this file,
   * every bucket is per-IP and lives for the whole process, so a fixed address
   * would make unrelated specs below rate-limit each other - pageAdd's
   * capacity of 10 is spent by the tenth test that forgot.
   *
   * ACROSS files, the buckets live in a Redis that every worker process
   * shares, and this file signs accounts up - so its addresses collide with
   * `account-routes.test.ts`, which mints its own from 10.0.0.1 upward for the
   * same `signup` bucket. Two files each politely using a "unique" address
   * still hand the same key to Redis, and signup's capacity of 3 is small
   * enough that the third caller gets a 429. The symptom was neither file's
   * fault in isolation: whichever spec happened to run third failed, in a
   * different place on each run.
   *
   * 172.20/16 is this file's alone. The rule for the next route spec is to
   * take a block of its own rather than a counter of its own.
   */
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

  /** A signed-in account, as its session cookie. */
  const signUp = async (target: Express = app): Promise<string> => {
    const response = await request(target)
      .post('/api/signup')
      .set('x-forwarded-for', uniqueIp())
      .send({email: `${randomUUID()}@pages.test`, password})
      .expect(201);
    return firstSetCookie(response);
  };

  /**
   * A public literal address, so the usecase's resolution check
   * short-circuits: a hostname would need real DNS, and `.test` deliberately
   * does not resolve at all. Nothing here ever fetches the url - no worker
   * runs in these specs.
   */
  const auditableUrl = (): string => `http://93.184.216.34/${randomUUID()}`;

  /** The account behind a session cookie, for specs that seed rows directly. */
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

  /**
   * A page owned by this session, created through the repository.
   *
   * Not through `POST /api/pages`, because these specs need an owned page as
   * a precondition, not the add endpoint's enqueue semantics. Keeping that
   * setup at the repository boundary isolates assertions about an existing
   * page from whether an accepted add enqueues work; specs about creating a
   * page still exercise the API.
   */
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
      // The limiter has to run BEFORE the auth middleware, which looks a
      // session up before rejecting it - otherwise an anonymous caller gets an
      // indexed query per request, as fast as it can open sockets, and every
      // bucket on this router sits behind the lookup it was meant to protect.
      //
      // This is the assertion that catches it, because the wrong order still
      // answers 401 forever and looks perfectly healthy. Registering auth as a
      // `router.use('/pages', ...)` above the routes is the tempting way to get
      // it wrong: Express runs layers in registration order, so the prefix
      // middleware wins wherever the limiters are written.
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
        // The public uuid, so the client can watch the first run exactly the
        // way an anonymous submission does.
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
      // A key-set assertion rather than a search for the site id's VALUE: both
      // are bigserials, so a page id of "2" and a site id of "2" collide by
      // coincidence and a value check passes or fails on insertion order. What
      // actually needs pinning is that no field can appear here without
      // somebody adding it to the mapper on purpose.
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
      // A fragment is never sent to the server, so the two audit identically.
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
      // Seeded through the repository so the setup does not couple this cap
      // response assertion to the enqueue semantics of the first ten adds.
      // This spec is about the ELEVENTH request's body, so only that request
      // goes through the API. The cap itself, including under concurrency, is
      // pinned in the repository spec.
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
      // Word for word what the worker says about an address it refuses at
      // fetch time: a difference would map the internal network.
      expect(loopback.body.error).toBe("That address can't be audited");

      expect((await addPage(cookie, 'ftp://example.com/')).status).toBe(400);
      expect((await addPage(cookie, 'not a url')).status).toBe(400);
      expect((await addPage(cookie, '')).status).toBe(400);

      const listed = await request(app).get('/api/pages').set('x-forwarded-for', uniqueIp()).set('cookie', cookie);
      expect(listed.body.pages).toEqual([]);
    });

    it('rate limits by address once the burst is spent', async () => {
      const cookie = await signUp();
      // Fixed, because this spec is about exhausting one address's bucket -
      // and out of a block the sequence above will never reach.
      const ip = '172.21.0.1';
      // Deliberately unauditable urls. A rejected submission is NOT refunded -
      // that is recorded in DECISIONS.md, because refunding a 400 would make
      // hostname probing free - so each of these spends a token just as an
      // accepted one would, while costing no page, no audit row and no
      // enqueue. Spending the bucket with real adds instead made this spec the
      // slowest in the suite and, when the shared Redis was busy, timed it out
      // on the queue rather than on anything to do with rate limiting.
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

      // The limiter runs before the controller, so it answers first.
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

      // Three finished audits and then a failure, so the row exercises both
      // halves: a trend to draw, and a latest run that has no score.
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
        // The delta badge survives the failed run, which is the whole point of
        // taking these from the finished audits rather than from the latest.
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

      // "false" as a STRING is the trap: a coercing schema reads it as true
      // and silently resumes monitoring the client asked to pause.
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
      // The share links for those audits stop resolving. Intended, and the
      // reason #20 confirms before calling this.
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

    /** A page with three finished audits and one failure, oldest to newest. */
    const pageWithTrend = async (cookie: string): Promise<string> => {
      const {pageId, url} = await seedPage(cookie);

      // The page's own first audit is queued and undated by these specs; the
      // trend below is what the assertions read.
      // Spaced so no spec's window boundary lands on a fixture timestamp: a
      // request made milliseconds after setup computes `since` from a slightly
      // later `now`, so an audit dated exactly on the edge falls out about
      // half the time.
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
      // The page's own queued first audit is in here too, newest of all.
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
      // The audits from five and three days ago fall outside it.
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
      // Echoed back, which is what makes clamping honest rather than a silent
      // truncation - the client can see it got a year rather than what it
      // asked for.
      expect(response.body.days).toBe(365);
    });

    it('rejects a window that is not a positive integer', async () => {
      const cookie = await signUp();
      const pageId = await pageWithTrend(cookie);

      // Clamping these would mean picking a number on the caller's behalf and
      // pretending they asked for it - different from `days=100000`, which is
      // a coherent request for more than we serve.
      for (const query of ['?days=abc', '?days=0', '?days=-5', '?days=1.5', '?days=']) {
        expect((await historyOf(cookie, pageId, query)).status).toBe(400);
      }
    });

    it('lets a browser cache it privately, keyed on the session', async () => {
      const cookie = await signUp();
      const pageId = await pageWithTrend(cookie);

      const response = await historyOf(cookie, pageId);

      // Beats the global no-store middleware, which is the point of the
      // allowlist on adaptRoute.
      expect(response.headers['cache-control']).toBe('private, max-age=60');
      // BOTH variants survive. `Vary` is a list and the CORS middleware has
      // already put `origin` in it; asserting only `Cookie` here passed while
      // the adapter was overwriting the header and quietly dropping Origin
      // from the cache key.
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
    /**
     * The acceptance criterion #10 handed to this issue. 404, never 403: a 403
     * says "this exists and is not yours", which is precisely the fact the
     * response must not carry - it turns id enumeration into an inventory of
     * everyone else's monitored pages.
     */
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

      // And nothing happened to her page.
      const row = await db
        .selectFrom('pages')
        .select('monitoring_enabled')
        .where('id', '=', pageId)
        .executeTakeFirstOrThrow();
      expect(row.monitoring_enabled).toBe(true);
    });

    it('answers the same 404 for an id that could never be a row', async () => {
      const cookie = await signUp();

      // A bigint column raises on these rather than matching nothing, so
      // without a guard they would be 500s that tell a prober the difference.
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
