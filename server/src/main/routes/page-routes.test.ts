import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import type { Express } from 'express'
import type { Kysely } from 'kysely'
import { setupApp } from '../config/app.js'
import { connectDatabase, disconnectDatabase, getDatabase } from '../config/database.js'
import { PAGE_LIMIT } from '../config/page-limits.js'
import { RATE_LIMITS } from '../config/rate-limits.js'
import type { Database } from '../../infra/db/postgres/database.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const password = 'correct horse battery staple'

describe('page routes', () => {
  let app: Express
  let db: Kysely<Database>

  beforeAll(() => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
    connectDatabase(url)
    db = getDatabase()
    app = setupApp()
  })

  afterAll(async () => {
    await disconnectDatabase()
  })

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
  let ipSeq = 0
  const uniqueIp = (): string => {
    ipSeq += 1
    return `172.20.${(ipSeq >> 8) & 255}.${ipSeq & 255}`
  }

  const firstSetCookie = (response: request.Response): string => {
    const header: unknown = response.headers['set-cookie']
    if (!Array.isArray(header) || typeof header[0] !== 'string') {
      throw new Error('expected a set-cookie header')
    }
    return header[0]
  }

  /** A signed-in account, as its session cookie. */
  const signUp = async (): Promise<string> => {
    const response = await request(app).post('/api/signup')
      .set('x-forwarded-for', uniqueIp())
      .send({ email: `${randomUUID()}@pages.test`, password })
      .expect(201)
    return firstSetCookie(response)
  }

  /**
   * A public literal address, so the usecase's resolution check
   * short-circuits: a hostname would need real DNS, and `.test` deliberately
   * does not resolve at all. Nothing here ever fetches the url - no worker
   * runs in these specs.
   */
  const auditableUrl = (): string => `http://93.184.216.34/${randomUUID()}`

  const addPage = async (cookie: string, url: string): Promise<request.Response> =>
    await request(app).post('/api/pages')
      .set('x-forwarded-for', uniqueIp()).set('cookie', cookie).send({ url })

  describe('authentication', () => {
    it('answers 401 on every route without a session', async () => {
      const responses = await Promise.all([
        request(app).post('/api/pages').set('x-forwarded-for', uniqueIp())
          .send({ url: auditableUrl() }),
        request(app).get('/api/pages').set('x-forwarded-for', uniqueIp()),
        request(app).patch('/api/pages/1').set('x-forwarded-for', uniqueIp())
          .send({ monitoringEnabled: false }),
        request(app).delete('/api/pages/1').set('x-forwarded-for', uniqueIp())
      ])

      expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401])
    })
  })

  describe('POST /api/pages', () => {
    it('creates the page and starts its first audit', async () => {
      const cookie = await signUp()
      const url = auditableUrl()

      const response = await addPage(cookie, url)

      expect(response.status).toBe(201)
      expect(response.body).toEqual({
        id: expect.any(String),
        url,
        monitoringEnabled: true,
        createdAt: expect.any(String),
        // The public uuid, so the client can watch the first run exactly the
        // way an anonymous submission does.
        firstAuditId: expect.stringMatching(UUID)
      })

      const audit = await db.selectFrom('audits')
        .select(['status', 'page_id'])
        .where('public_uuid', '=', response.body.firstAuditId as string)
        .executeTakeFirstOrThrow()
      expect(audit.status).toBe('queued')
      expect(audit.page_id).toBe(response.body.id)
    })

    it('answers with exactly the documented fields and nothing else', async () => {
      // A key-set assertion rather than a search for the site id's VALUE: both
      // are bigserials, so a page id of "2" and a site id of "2" collide by
      // coincidence and a value check passes or fails on insertion order. What
      // actually needs pinning is that no field can appear here without
      // somebody adding it to the mapper on purpose.
      const cookie = await signUp()

      const response = await addPage(cookie, auditableUrl())

      expect(Object.keys(response.body as Record<string, unknown>).sort())
        .toEqual(['createdAt', 'firstAuditId', 'id', 'monitoringEnabled', 'url'])
    })

    it('normalises the url before storing it, so a fragment is not a second page', async () => {
      const cookie = await signUp()
      const path = randomUUID()

      const first = await addPage(cookie, `http://93.184.216.34/${path}`)
      const again = await addPage(cookie, `http://93.184.216.34/${path}#pricing`)

      expect(first.status).toBe(201)
      // A fragment is never sent to the server, so the two audit identically.
      expect(again.status).toBe(409)
      expect(again.body.code).toBe('page_already_tracked')
    })

    it('creates neither a second site nor a second page for a duplicate submission', async () => {
      const cookie = await signUp()
      const url = auditableUrl()

      const first = await addPage(cookie, url)
      const second = await addPage(cookie, url)

      expect(first.status).toBe(201)
      expect(second.status).toBe(409)

      const page = await db.selectFrom('pages').select('site_id')
        .where('id', '=', first.body.id as string).executeTakeFirstOrThrow()
      const sites = await db.selectFrom('sites').select('id')
        .where('id', '=', page.site_id).execute()
      expect(sites).toHaveLength(1)

      const audits = await db.selectFrom('audits').select('id')
        .where('page_id', '=', first.body.id as string).execute()
      expect(audits).toHaveLength(1)
    })

    it('groups a second page on the same host under the account\'s existing site', async () => {
      const cookie = await signUp()

      const first = await addPage(cookie, auditableUrl())
      const second = await addPage(cookie, auditableUrl())

      const rows = await db.selectFrom('pages').select('site_id')
        .where('id', 'in', [first.body.id as string, second.body.id as string]).execute()

      expect(new Set(rows.map((row) => row.site_id)).size).toBe(1)
    })

    it('refuses the page past the account cap, with a body the UI can render', async () => {
      const cookie = await signUp()
      // pageAdd's capacity is exactly PAGE_LIMIT, so the eleventh call would
      // be a 429 from a shared address rather than the 409 this is about.
      for (let index = 0; index < PAGE_LIMIT; index++) {
        expect((await addPage(cookie, auditableUrl())).status).toBe(201)
      }

      const refused = await addPage(cookie, auditableUrl())

      expect(refused.status).toBe(409)
      expect(refused.body).toEqual({
        code: 'page_limit_reached',
        limit: PAGE_LIMIT,
        error: expect.stringContaining(String(PAGE_LIMIT))
      })
    })

    it('rejects an unsafe url without creating anything', async () => {
      const cookie = await signUp()

      const loopback = await addPage(cookie, 'http://127.0.0.1/admin')
      expect(loopback.status).toBe(400)
      // Word for word what the worker says about an address it refuses at
      // fetch time: a difference would map the internal network.
      expect(loopback.body.error).toBe("That address can't be audited")

      expect((await addPage(cookie, 'ftp://example.com/')).status).toBe(400)
      expect((await addPage(cookie, 'not a url')).status).toBe(400)
      expect((await addPage(cookie, '')).status).toBe(400)

      const listed = await request(app).get('/api/pages')
        .set('x-forwarded-for', uniqueIp()).set('cookie', cookie)
      expect(listed.body.pages).toEqual([])
    })

    it('rate limits by address once the burst is spent', async () => {
      const cookie = await signUp()
      // Fixed, because this spec is about exhausting one address's bucket -
      // and out of a block the sequence above will never reach.
      const ip = '172.21.0.1'
      const submit = async (): Promise<number> => (await request(app).post('/api/pages')
        .set('x-forwarded-for', ip).set('cookie', cookie)
        .send({ url: auditableUrl() })).status

      for (let index = 0; index < RATE_LIMITS.pageAdd.capacity; index++) await submit()

      expect(await submit()).toBe(429)
    })
  })

  describe('GET /api/pages', () => {
    it('answers the empty state with the cap, not just an empty list', async () => {
      const cookie = await signUp()

      const response = await request(app).get('/api/pages')
        .set('x-forwarded-for', uniqueIp()).set('cookie', cookie)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ pages: [], limit: PAGE_LIMIT, used: 0 })
    })

    it('serves the dashboard row: score, previous score, sparkline and status', async () => {
      const cookie = await signUp()
      const added = await addPage(cookie, auditableUrl())
      const pageId = added.body.id as string

      // Three finished audits and then a failure, so the row exercises both
      // halves: a trend to draw, and a latest run that has no score.
      for (const score of [70, 82, 91]) {
        await db.insertInto('audits').values({
          page_id: pageId, url: added.body.url as string, status: 'done', score
        }).execute()
      }
      await db.insertInto('audits').values({
        page_id: pageId, url: added.body.url as string, status: 'failed',
        error: 'Navigation timed out'
      }).execute()

      const response = await request(app).get('/api/pages')
        .set('x-forwarded-for', uniqueIp()).set('cookie', cookie)

      expect(response.status).toBe(200)
      expect(response.body.used).toBe(1)
      const [page] = response.body.pages as Array<Record<string, unknown>>
      expect(page).toMatchObject({
        id: pageId,
        domain: '93.184.216.34',
        monitoringEnabled: true,
        // The delta badge survives the failed run, which is the whole point of
        // taking these from the finished audits rather than from the latest.
        score: 91,
        previousScore: 82,
        latestAudit: { status: 'failed', score: null, error: 'Navigation timed out' }
      })
      expect(page?.history).toEqual([
        { score: 70, at: expect.any(String) },
        { score: 82, at: expect.any(String) },
        { score: 91, at: expect.any(String) }
      ])
    })

    it('never returns another account\'s pages', async () => {
      const [alice, bob] = await Promise.all([signUp(), signUp()])
      await addPage(alice, auditableUrl())

      const response = await request(app).get('/api/pages')
        .set('x-forwarded-for', uniqueIp()).set('cookie', bob)

      expect(response.body).toEqual({ pages: [], limit: PAGE_LIMIT, used: 0 })
    })
  })

  describe('PATCH /api/pages/:id', () => {
    it('pauses and resumes monitoring without losing history', async () => {
      const cookie = await signUp()
      const added = await addPage(cookie, auditableUrl())
      const pageId = added.body.id as string

      const paused = await request(app).patch(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp()).set('cookie', cookie)
        .send({ monitoringEnabled: false })

      expect(paused.status).toBe(200)
      expect(paused.body).toMatchObject({ id: pageId, monitoringEnabled: false })

      const resumed = await request(app).patch(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp()).set('cookie', cookie)
        .send({ monitoringEnabled: true })
      expect(resumed.body.monitoringEnabled).toBe(true)

      const audits = await db.selectFrom('audits').select('id')
        .where('page_id', '=', pageId).execute()
      expect(audits).toHaveLength(1)
    })

    it('rejects a body that does not carry a boolean', async () => {
      const cookie = await signUp()
      const added = await addPage(cookie, auditableUrl())

      // "false" as a STRING is the trap: a coercing schema reads it as true
      // and silently resumes monitoring the client asked to pause.
      const coerced = await request(app).patch(`/api/pages/${added.body.id as string}`)
        .set('x-forwarded-for', uniqueIp()).set('cookie', cookie)
        .send({ monitoringEnabled: 'false' })

      expect(coerced.status).toBe(400)

      const row = await db.selectFrom('pages').select('monitoring_enabled')
        .where('id', '=', added.body.id as string).executeTakeFirstOrThrow()
      expect(row.monitoring_enabled).toBe(true)
    })
  })

  describe('DELETE /api/pages/:id', () => {
    it('removes the page and its whole audit history', async () => {
      const cookie = await signUp()
      const added = await addPage(cookie, auditableUrl())
      const pageId = added.body.id as string

      const response = await request(app).delete(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp()).set('cookie', cookie)

      expect(response.status).toBe(204)
      expect(await db.selectFrom('pages').select('id')
        .where('id', '=', pageId).executeTakeFirst()).toBeUndefined()
      // The share links for those audits stop resolving. Intended, and the
      // reason #20 confirms before calling this.
      expect(await db.selectFrom('audits').select('id')
        .where('page_id', '=', pageId).executeTakeFirst()).toBeUndefined()
    })

    it('answers 404 for a second delete rather than pretending it worked', async () => {
      const cookie = await signUp()
      const added = await addPage(cookie, auditableUrl())
      const pageId = added.body.id as string

      await request(app).delete(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp()).set('cookie', cookie).expect(204)

      const again = await request(app).delete(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp()).set('cookie', cookie)
      expect(again.status).toBe(404)
    })
  })

  describe('cross-account access', () => {
    /**
     * The acceptance criterion #10 handed to this issue. 404, never 403: a 403
     * says "this exists and is not yours", which is precisely the fact the
     * response must not carry - it turns id enumeration into an inventory of
     * everyone else's monitored pages.
     */
    it('answers 404, never 403, on every route that names a page', async () => {
      const [alice, bob] = await Promise.all([signUp(), signUp()])
      const hers = await addPage(alice, auditableUrl())
      const pageId = hers.body.id as string

      const patched = await request(app).patch(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp()).set('cookie', bob)
        .send({ monitoringEnabled: false })
      const deleted = await request(app).delete(`/api/pages/${pageId}`)
        .set('x-forwarded-for', uniqueIp()).set('cookie', bob)

      expect([patched.status, deleted.status]).toEqual([404, 404])

      // And nothing happened to her page.
      const row = await db.selectFrom('pages').select('monitoring_enabled')
        .where('id', '=', pageId).executeTakeFirstOrThrow()
      expect(row.monitoring_enabled).toBe(true)
    })

    it('answers the same 404 for an id that could never be a row', async () => {
      const cookie = await signUp()

      // A bigint column raises on these rather than matching nothing, so
      // without a guard they would be 500s that tell a prober the difference.
      const responses = await Promise.all([
        request(app).delete('/api/pages/not-a-number')
          .set('x-forwarded-for', uniqueIp()).set('cookie', cookie),
        request(app).delete('/api/pages/99999999999999999999')
          .set('x-forwarded-for', uniqueIp()).set('cookie', cookie),
        request(app).patch('/api/pages/not-a-number')
          .set('x-forwarded-for', uniqueIp()).set('cookie', cookie)
          .send({ monitoringEnabled: false })
      ])

      expect(responses.map((response) => response.status)).toEqual([404, 404, 404])
    })
  })
})
