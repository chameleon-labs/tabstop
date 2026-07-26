import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import { makeDatabase } from '../helpers/postgres-helper.js'
import { PostgresAuditRepository } from './postgres-audit-repository.js'
import type { Database } from '../database.js'

describe('PostgresAuditRepository', () => {
  let db: Kysely<Database>
  let sut: PostgresAuditRepository

  beforeAll(() => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
    db = makeDatabase(url)
    sut = new PostgresAuditRepository(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  const makePage = async (): Promise<string> => {
    const site = await db.insertInto('sites')
      .values({ domain: `${randomUUID()}.test` })
      .returning('id').executeTakeFirstOrThrow()
    const page = await db.insertInto('pages')
      .values({ site_id: site.id, url: `https://${randomUUID()}.test/a` })
      .returning('id').executeTakeFirstOrThrow()
    return page.id
  }

  describe('add', () => {
    it('creates a queued anonymous audit', async () => {
      const url = `https://${randomUUID()}.test/x`
      const audit = await sut.add({ url, pageId: null })

      expect(audit.status).toBe('queued')
      expect(audit.pageId).toBeNull()
      expect(audit.url).toBe(url)
    })

    it('returns an id and an unguessable public uuid, which are not the same value', async () => {
      // The share page (#23) is addressed by public_uuid; the internal id must
      // never be what the world sees.
      const audit = await sut.add({ url: `https://${randomUUID()}.test/y`, pageId: null })

      expect(typeof audit.id).toBe('string')
      expect(audit.publicUuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(audit.publicUuid).not.toBe(audit.id)
    })

    it('defaults counts to zero for every impact', async () => {
      const audit = await sut.add({ url: `https://${randomUUID()}.test/z`, pageId: null })

      expect(audit.countsByImpact).toEqual({ minor: 0, moderate: 0, serious: 0, critical: 0 })
    })

    it('leaves the result fields empty until the worker fills them', async () => {
      const audit = await sut.add({ url: `https://${randomUUID()}.test/w`, pageId: null })

      expect(audit.score).toBeNull()
      expect(audit.axeVersion).toBeNull()
      expect(audit.durationMs).toBeNull()
      expect(audit.error).toBeNull()
      expect(audit.completedAt).toBeNull()
    })

    it('attaches the audit to a page when given one', async () => {
      const pageId = await makePage()

      const audit = await sut.add({ url: `https://${randomUUID()}.test/a`, pageId })

      expect(audit.pageId).toBe(pageId)
    })
  })

  describe('loadByPublicUuid', () => {
    it('returns the audit that was created', async () => {
      const created = await sut.add({ url: `https://${randomUUID()}.test/find-me`, pageId: null })

      const found = await sut.loadByPublicUuid(created.publicUuid)

      expect(found).toEqual(created)
    })

    it('returns null for an unknown uuid', async () => {
      const found = await sut.loadByPublicUuid('00000000-0000-0000-0000-000000000000')

      expect(found).toBeNull()
    })

    it('returns null for a malformed uuid instead of rejecting', async () => {
      const found = await sut.loadByPublicUuid('not-a-uuid')

      expect(found).toBeNull()
    })
  })
})
