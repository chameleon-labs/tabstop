import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import { makeDatabase } from '../helpers/postgres-helper.js'
import { PostgresAuditRepository, claimLeaseFor } from './postgres-audit-repository.js'
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

    // Terminal writes are fenced on the claim, so a test that finishes an
    // audit has to claim it first, exactly as the worker does.
    const makeClaimedAudit = async (): Promise<{ id: string, claimedAt: Date }> => {
      const id = await makeQueuedAudit()
      const claimedAt = await sut.claimForRun(id)
      if (claimedAt === null) throw new Error('fixture failed to claim')
      return { id, claimedAt }
    }

    const load = async (id: string) =>
      await db.selectFrom('audits').selectAll().where('id', '=', id).executeTakeFirstOrThrow()

    it('claims a queued audit', async () => {
      const id = await makeQueuedAudit()

      expect(await sut.claimForRun(id)).toBeInstanceOf(Date)
      expect((await load(id)).status).toBe('running')
    })

    it('refuses a second claim while the first is still live', async () => {
      // Status alone is not exclusion: under READ COMMITTED the second
      // delivery re-checks the predicate after the first commits, and would
      // match the row the first just claimed. The lease is what excludes it.
      const id = await makeQueuedAudit()
      await sut.claimForRun(id)

      expect(await sut.claimForRun(id)).toBeNull()
    })

    it('reclaims an audit whose worker died and left the claim stale', async () => {
      const id = await makeQueuedAudit()
      await sut.claimForRun(id)

      // Age the claim rather than shortening the lease: a zero-length lease
      // compares two clock reads that can land in the same millisecond, which
      // makes the test flaky. Writing an old timestamp exercises the real
      // production lease and is deterministic.
      await db.updateTable('audits')
        .set({ claimed_at: new Date(Date.now() - 60 * 60_000) })
        .where('id', '=', id).execute()

      expect(await sut.claimForRun(id)).toBeInstanceOf(Date)
    })

    it('lets exactly one of several concurrent deliveries claim a queued audit', async () => {
      const id = await makeQueuedAudit()

      const claims = await Promise.all([
        sut.claimForRun(id), sut.claimForRun(id), sut.claimForRun(id)
      ])

      expect(claims.filter((claim) => claim !== null)).toHaveLength(1)
    })

    it('refuses to resurrect an audit that already finished', async () => {
      // Two deliveries can race: one finishes while the other is between
      // reading the row and claiming it. A plain update would put a completed
      // audit back into `running` and let a later run overwrite its result.
      for (const finish of ['done', 'failed'] as const) {
        const { id, claimedAt } = await makeClaimedAudit()
        if (finish === 'done') {
          await sut.markDone(id, claimedAt, {
            countsByImpact: { minor: 0, moderate: 0, serious: 0, critical: 0 },
            axeVersion: '4.12.1', durationMs: 1, settled: true
          })
        } else {
          await sut.markFailed(id, claimedAt, 'Could not resolve that domain')
        }

        expect(await sut.claimForRun(id)).toBeNull()
        expect((await load(id)).status).toBe(finish)
      }
    })

    it('refuses every concurrent delivery once the audit has finished', async () => {
      const { id, claimedAt } = await makeClaimedAudit()
      await sut.markDone(id, claimedAt, {
        countsByImpact: { minor: 0, moderate: 0, serious: 0, critical: 0 },
        axeVersion: '4.12.1', durationMs: 1, settled: true
      })

      const claims = await Promise.all([
        sut.claimForRun(id), sut.claimForRun(id), sut.claimForRun(id)
      ])

      expect(claims).toEqual([null, null, null])
    })

    it('ignores a terminal write from an attempt that lost its claim', async () => {
      // A paused attempt can resume after another worker reclaimed and finished
      // the audit. Unfenced, markDone would overwrite the new owner's result
      // and markFailed would turn a success into a failure.
      const { id, claimedAt } = await makeClaimedAudit()
      await db.updateTable('audits')
        .set({ claimed_at: new Date(Date.now() - 60 * 60_000) })
        .where('id', '=', id).execute()
      const newOwner = await sut.claimForRun(id)
      if (newOwner === null) throw new Error('fixture failed to reclaim')
      await sut.markDone(id, newOwner, {
        countsByImpact: { minor: 0, moderate: 0, serious: 0, critical: 0 },
        axeVersion: '4.12.1', durationMs: 1, settled: true
      })

      await sut.markFailed(id, claimedAt, 'stale attempt reporting failure')

      const row = await load(id)
      expect(row.status).toBe('done')
      expect(row.error).toBeNull()
    })

    it('lets the next attempt claim once the previous one released', async () => {
      // The regression this pins: a retryable failure writes no terminal
      // status, so without a release the row keeps a live lease and the retry
      // - which arrives seconds later - can never claim it.
      const id = await makeQueuedAudit()
      const claimedAt = await sut.claimForRun(id)
      if (claimedAt === null) throw new Error('fixture failed to claim')

      await sut.releaseClaim(id, claimedAt)

      expect((await load(id)).status).toBe('queued')
      expect(await sut.claimForRun(id)).toBeInstanceOf(Date)
    })

    it('ignores a release from an attempt that no longer holds the claim', async () => {
      const id = await makeQueuedAudit()
      const stale = await sut.claimForRun(id)
      if (stale === null) throw new Error('fixture failed to claim')
      await sut.releaseClaim(id, stale)
      const current = await sut.claimForRun(id)

      // The superseded attempt tries to release the claim it used to hold.
      await sut.releaseClaim(id, stale)

      expect(current).toBeInstanceOf(Date)
      expect((await load(id)).status).toBe('running')
    })

    it('refuses to drag a finished audit back to queued', async () => {
      const { id, claimedAt } = await makeClaimedAudit()
      await sut.markFailed(id, claimedAt, 'Could not resolve that domain')

      await sut.releaseClaim(id, claimedAt)

      expect((await load(id)).status).toBe('failed')
    })

    it('marks an audit done with counts, version, duration and settled', async () => {
      const { id, claimedAt } = await makeClaimedAudit()

      await sut.markDone(id, claimedAt, {
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
      const { id, claimedAt } = await makeClaimedAudit()

      await sut.markDone(id, claimedAt, {
        countsByImpact: { minor: 0, moderate: 0, serious: 0, critical: 0 },
        axeVersion: '4.12.1',
        durationMs: 10,
        settled: true
      })

      expect((await load(id)).counts_by_impact)
        .toEqual({ minor: 0, moderate: 0, serious: 0, critical: 0 })
    })

    it('marks an audit failed with a readable message and a completion time', async () => {
      const { id, claimedAt } = await makeClaimedAudit()

      await sut.markFailed(id, claimedAt, 'Could not resolve that domain')

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

  describe('deleteIfQueued', () => {
    it('removes an audit that is still queued', async () => {
      const audit = await sut.add({ url: `https://${randomUUID()}.test/x`, pageId: null })

      await sut.deleteIfQueued(audit.id)

      expect(await sut.loadById(audit.id)).toBeNull()
    })

    it('refuses to remove an audit that is no longer queued', async () => {
      // This is the only delete on the repository. The status predicate is
      // what keeps it from ever removing a real audit - by the time anything
      // is running or finished, somebody is relying on it.
      for (const advance of ['running', 'done', 'failed'] as const) {
        const audit = await sut.add({ url: `https://${randomUUID()}.test/x`, pageId: null })
        const claimedAt = await sut.claimForRun(audit.id)
        if (claimedAt === null) throw new Error('fixture failed to claim')

        if (advance === 'done') {
          await sut.markDone(audit.id, claimedAt, {
            countsByImpact: { minor: 0, moderate: 0, serious: 0, critical: 0 },
            axeVersion: '4.12.1', durationMs: 1, settled: true
          })
        } else if (advance === 'failed') {
          await sut.markFailed(audit.id, claimedAt, 'Could not resolve that domain')
        }

        await sut.deleteIfQueued(audit.id)

        expect(await sut.loadById(audit.id)).not.toBeNull()
      }
    })

    it('is silent about an id that does not exist', async () => {
      await expect(sut.deleteIfQueued('999999999')).resolves.toBeUndefined()
    })
  })
})

describe('claimLeaseFor', () => {
  const MAX_JOB_TIMEOUT_MS = 600_000
  const UNWIND_GRACE_MS = 15_000

  it('outlasts the longest an attempt can possibly occupy', () => {
    // The regression this pins: a flat ten-minute lease looked generous
    // against the 45s default and was in fact SHORTER than the maximum the
    // environment schema permits (600s) plus its unwind grace (15s) - so a
    // valid configuration let a second worker reclaim a still-running audit.
    for (const jobTimeoutMs of [45_000, 120_000, MAX_JOB_TIMEOUT_MS]) {
      const longestPossibleAttempt = jobTimeoutMs + UNWIND_GRACE_MS

      expect(claimLeaseFor(jobTimeoutMs, UNWIND_GRACE_MS))
        .toBeGreaterThan(longestPossibleAttempt)
    }
  })

  it('grows with the configured budget rather than staying fixed', () => {
    expect(claimLeaseFor(600_000, UNWIND_GRACE_MS))
      .toBeGreaterThan(claimLeaseFor(45_000, UNWIND_GRACE_MS))
  })
})
