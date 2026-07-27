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
    const user = await db.insertInto('users')
      .values({ email: `${randomUUID()}@test.test`, password_digest: 'x' })
      .returning('id').executeTakeFirstOrThrow()
    const site = await db.insertInto('sites')
      .values({ user_id: user.id, domain: `${randomUUID()}.test` })
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

  describe('status transitions', () => {
    const makeQueuedAudit = async (): Promise<string> => {
      const audit = await sut.add({ url: `https://${randomUUID()}.test/x`, pageId: null })
      return audit.id
    }

    const load = async (id: string) =>
      await db.selectFrom('audits').selectAll().where('id', '=', id).executeTakeFirstOrThrow()

    it('claims a queued audit', async () => {
      const id = await makeQueuedAudit()

      expect(await sut.claimForRun(id)).toBe(true)
      expect((await load(id)).status).toBe('running')
    })

    it('claims an audit left running by a worker that died mid-audit', async () => {
      const id = await makeQueuedAudit()
      await sut.claimForRun(id)

      expect(await sut.claimForRun(id)).toBe(true)
    })

    it('refuses to resurrect an audit that already finished', async () => {
      // Two deliveries can race: one finishes while the other is between
      // reading the row and claiming it. A plain update would put a completed
      // audit back into `running` and let a later run overwrite its result.
      for (const finish of ['done', 'failed'] as const) {
        const id = await makeQueuedAudit()
        if (finish === 'done') {
          await sut.markDone(id, {
            countsByImpact: { minor: 0, moderate: 0, serious: 0, critical: 0 },
            axeVersion: '4.12.1', durationMs: 1, settled: true
          })
        } else {
          await sut.markFailed(id, 'Could not resolve that domain')
        }

        expect(await sut.claimForRun(id)).toBe(false)
        expect((await load(id)).status).toBe(finish)
      }
    })

    it('lets exactly one of several concurrent deliveries claim the audit', async () => {
      const id = await makeQueuedAudit()
      await sut.markDone(id, {
        countsByImpact: { minor: 0, moderate: 0, serious: 0, critical: 0 },
        axeVersion: '4.12.1', durationMs: 1, settled: true
      })

      const claims = await Promise.all([
        sut.claimForRun(id), sut.claimForRun(id), sut.claimForRun(id)
      ])

      expect(claims).toEqual([false, false, false])
    })

    it('marks an audit done with counts, version, duration and settled', async () => {
      const id = await makeQueuedAudit()

      await sut.markDone(id, {
        countsByImpact: { minor: 1, moderate: 0, serious: 2, critical: 3 },
        axeVersion: '4.12.1',
        durationMs: 1234,
        settled: false
      })

      const row = await load(id)
      expect(row.status).toBe('done')
      // jsonb reorders keys, so this must be compared structurally.
      expect(row.counts_by_impact).toEqual({ minor: 1, moderate: 0, serious: 2, critical: 3 })
      expect(row.axe_version).toBe('4.12.1')
      expect(row.duration_ms).toBe(1234)
      expect(row.settled).toBe(false)
      expect(row.completed_at).toBeInstanceOf(Date)
      // Scoring is #6; this worker never writes one.
      expect(row.score).toBeNull()
    })

    it('writes all four impact keys, which the check constraint requires', async () => {
      const id = await makeQueuedAudit()

      await sut.markDone(id, {
        countsByImpact: { minor: 0, moderate: 0, serious: 0, critical: 0 },
        axeVersion: '4.12.1',
        durationMs: 10,
        settled: true
      })

      expect((await load(id)).counts_by_impact)
        .toEqual({ minor: 0, moderate: 0, serious: 0, critical: 0 })
    })

    it('marks an audit failed with a readable message and a completion time', async () => {
      const id = await makeQueuedAudit()

      await sut.markFailed(id, 'Could not resolve that domain')

      const row = await load(id)
      expect(row.status).toBe('failed')
      expect(row.error).toBe('Could not resolve that domain')
      expect(row.completed_at).toBeInstanceOf(Date)
    })
  })

  describe('loadById', () => {
    it('returns the audit for an internal id', async () => {
      const created = await sut.add({ url: `https://${randomUUID()}.test/x`, pageId: null })

      expect(await sut.loadById(created.id)).toEqual(created)
    })

    it('returns null for an id that does not exist', async () => {
      expect(await sut.loadById('999999999')).toBeNull()
    })
  })
})
