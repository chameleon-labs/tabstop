import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import type { Express } from 'express'
import type { Kysely } from 'kysely'
import { setupApp } from '../config/app.js'
import { env } from '../config/env.js'
import { connectDatabase, disconnectDatabase, getDatabase } from '../config/database.js'
import type { Database } from '../../infra/db/postgres/database.js'
import { PostgresAuditRepository } from '../../infra/db/postgres/audit/postgres-audit-repository.js'
import {
  PostgresViolationRepository
} from '../../infra/db/postgres/violation/postgres-violation-repository.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('audit routes', () => {
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

  // The audit bucket lives for the whole process and has a small capacity
  // (default 5), so a fixed submitter IP would make the many unrelated specs
  // below rate-limit each other. A fresh address per call keeps each of them
  // independent; the two specs that deliberately exercise the limiter define
  // their own local `submit` with a fixed or looped address instead.
  let ipSeq = 0
  const uniqueIp = (): string => {
    ipSeq += 1
    return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`
  }

  const submit = async (url: string) => await request(app).post('/api/audits')
    .set('x-forwarded-for', uniqueIp()).send({ url })

  /**
   * A public literal address, so gate 1 short-circuits resolution: a hostname
   * would need real DNS, and `.test` deliberately does not resolve at all.
   * Nothing here ever fetches the URL - no worker runs in these specs.
   */
  const auditableUrl = (): string => `http://93.184.216.34/${randomUUID()}`

  describe('POST /api/audits', () => {
    it('accepts a URL and returns a public id to poll', async () => {
      const response = await submit(auditableUrl())

      expect(response.status).toBe(202)
      expect(response.body.auditId).toMatch(UUID)
      expect(response.body.status).toBe('queued')
      expect(response.body.pollAfterMs).toBeGreaterThan(0)
    })

    it('never returns the internal id', async () => {
      const response = await submit(auditableUrl())
      const row = await db.selectFrom('audits').select(['id'])
        .where('public_uuid', '=', response.body.auditId as string).executeTakeFirstOrThrow()

      // Compared structurally, not as a substring: the internal id is a
      // bigserial, so a single digit matches by coincidence inside a uuid or a
      // timestamp and would prove nothing either way.
      expect(response.body.auditId).not.toBe(row.id)
      expect(Object.values(response.body)).not.toContain(row.id)
    })

    it('rejects the addresses gate 1 exists to catch', async () => {
      // The submission-time half of #7: an obviously bad URL becomes a 400
      // here rather than a queued job, a browser launch, and a failed audit
      // thirty seconds later.
      for (const url of [
        'file:///etc/passwd',
        'https://alice:secret@example.com/',
        'data:text/html,<h1>x',
        'javascript:alert(1)',
        'http://169.254.169.254/latest/meta-data/',
        'http://127.0.0.1/',
        'http://example.com:8080/',
        'not a url'
      ]) {
        const response = await submit(url)
        expect(response.status).toBe(400)
        expect(typeof response.body.error).toBe('string')
      }
    })

    it('rejects a request with no url at all', async () => {
      expect((await request(app).post('/api/audits').set('x-forwarded-for', uniqueIp())
        .send({})).status).toBe(400)
    })

    it('stores nothing for a rejected URL', async () => {
      // Both branches fixed this independently and each caught half of it;
      // this keeps both halves.
      //
      // A unique marker, because the specs share one Postgres container and
      // vitest runs files in parallel - a table-wide count reports whichever
      // row another file inserted in the same instant, which is exactly how
      // this assertion started flaking.
      //
      // And `like` on that marker rather than `=` on the whole url, because a
      // regression that stored a NORMALISED variant - a trailing slash, a
      // percent-decoded path - would match `=` on nothing and pass with the
      // bug present. The marker is what keeps widening the match safe: no
      // other spec can produce a row containing it.
      const marker = randomUUID()

      await submit(`file:///etc/passwd?${marker}`)

      const stored = await db.selectFrom('audits').select(db.fn.countAll().as('n'))
        .where('url', 'like', `%${marker}%`)
        .executeTakeFirstOrThrow()
      expect(Number(stored.n)).toBe(0)
    })

    it('answers 429 once the per-IP bucket is empty', async () => {
      // Distinct IP per spec: the bucket is shared process-wide, so a fixed
      // address would make these specs depend on each other's order.
      const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`
      const submit = async () => await request(app)
        .post('/api/audits').set('x-forwarded-for', ip).send({ url: auditableUrl() })

      const statuses: number[] = []
      for (let i = 0; i < env.auditRateCapacity + 1; i++) {
        statuses.push((await submit()).status)
      }

      expect(statuses.at(-1)).toBe(429)
      expect(statuses.slice(0, -1).every((status) => status === 202)).toBe(true)
    })

    it('ignores a forwarded address the proxy did not write', async () => {
      // With one trusted hop, supertest's connection is the trusted proxy and
      // the client-supplied entry to its left is not. If Express trusted the
      // whole chain, each spoofed address would mint a fresh bucket and the
      // limiter would be decorative.
      const spoofed = async (address: string) => await request(app)
        .post('/api/audits')
        .set('x-forwarded-for', `${address}, 203.0.113.1`)
        .send({ url: auditableUrl() })

      const statuses: number[] = []
      for (let i = 0; i < env.auditRateCapacity + 1; i++) {
        statuses.push((await spoofed(`10.0.0.${i + 1}`)).status)
      }

      expect(statuses.at(-1)).toBe(429)
    })
  })

  describe('GET /api/audits/:uuid', () => {
    it('reports a queued audit, and refuses to let it be cached', async () => {
      const created = await submit(auditableUrl())

      const response = await request(app).get(`/api/audits/${created.body.auditId as string}`)

      expect(response.status).toBe(200)
      expect(response.body.status).toBe('queued')
      expect(response.body.violations).toEqual([])
      // It changes on the next poll, so nothing may hold it.
      expect(response.headers['cache-control']).toBe('no-store')
    })

    it('reports a finished audit with its violations, and lets it be cached', async () => {
      const created = await submit(auditableUrl())
      const auditId = created.body.auditId as string
      const audits = new PostgresAuditRepository(db)
      const violations = new PostgresViolationRepository(db)
      const row = await db.selectFrom('audits').select(['id'])
        .where('public_uuid', '=', auditId).executeTakeFirstOrThrow()

      const claimedAt = await audits.claimForRun(row.id)
      if (claimedAt === null) throw new Error('fixture failed to claim')
      await violations.replaceAll(row.id, claimedAt, [{
        ruleId: 'image-alt',
        impact: 'critical',
        description: 'Images must have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
        nodes: [{ target: ['img'], html: '<img>' }]
      }])
      await audits.markDone(row.id, claimedAt, {
        score: 90,
        countsByImpact: { minor: 0, moderate: 0, serious: 0, critical: 1 },
        axeVersion: '4.12.1',
        durationMs: 1234,
        settled: true
      })

      const response = await request(app).get(`/api/audits/${auditId}`)

      expect(response.status).toBe(200)
      expect(response.body.status).toBe('done')
      expect(response.body.score).toBe(90)
      expect(response.body.axeVersion).toBe('4.12.1')
      expect(response.body.settled).toBe(true)
      expect(response.body.violations).toEqual([{
        ruleId: 'image-alt',
        impact: 'critical',
        description: 'Images must have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
        nodes: [{ target: ['img'], html: '<img>' }]
      }])
      // Terminal and immutable, so the share page can be served from a cache.
      expect(response.headers['cache-control']).toBe('public, max-age=3600')
    })

    it('leaks nothing that identifies a user', async () => {
      // This endpoint is public to anyone holding the uuid, so the payload is
      // the whole security boundary.
      const created = await submit(auditableUrl())
      const auditId = created.body.auditId as string
      const row = await db.selectFrom('audits').select(['id'])
        .where('public_uuid', '=', auditId).executeTakeFirstOrThrow()

      const response = await request(app).get(`/api/audits/${auditId}`)

      const keys = Object.keys(response.body)
      for (const forbidden of ['pageId', 'page_id', 'id', 'siteId', 'userId', 'durationMs']) {
        expect(keys).not.toContain(forbidden)
      }
      // Structural again - a bigserial id is one or two characters, so a
      // substring check would match by chance and mean nothing.
      expect(Object.values(response.body)).not.toContain(row.id)
      expect(response.body.auditId).not.toBe(row.id)
    })

    it('answers 404 for an id no audit carries', async () => {
      expect((await request(app).get(`/api/audits/${randomUUID()}`)).status).toBe(404)
    })

    it('answers 404 for a malformed id rather than 500', async () => {
      // A value that cannot be a uuid is a miss, not a database error.
      for (const bad of ['not-a-uuid', '123', 'a'.repeat(50)]) {
        expect((await request(app).get(`/api/audits/${bad}`)).status).toBe(404)
      }
    })
  })
})
