import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import { DbRunAudit } from './db-run-audit.js'
import { PermanentAuditError } from '../../../domain/errors/permanent-audit-error.js'
import { PlaywrightAxeAuditor } from '../../../infra/audit/playwright-axe-auditor.js'
import { startFixtureServer, type FixtureServer } from '../../../infra/audit/test/fixture-server.js'
import { makeDatabase } from '../../../infra/db/postgres/helpers/postgres-helper.js'
import type { Database } from '../../../infra/db/postgres/database.js'
import { PostgresAuditRepository } from '../../../infra/db/postgres/audit/postgres-audit-repository.js'
import {
  PostgresViolationRepository
} from '../../../infra/db/postgres/violation/postgres-violation-repository.js'

/**
 * The acceptance criterion for #5, with nothing faked below the queue: a real
 * audit row, a real browser, a real page, and a real database. The unit specs
 * cover the branches; this proves the pieces actually fit together.
 */
describe('run-audit end to end', () => {
  let db: Kysely<Database>
  let server: FixtureServer
  let auditor: PlaywrightAxeAuditor
  let sut: DbRunAudit
  let violations: PostgresViolationRepository

  beforeAll(async () => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
    db = makeDatabase(url)
    server = await startFixtureServer()
    auditor = new PlaywrightAxeAuditor({
      navigationMs: 20_000, settleMs: 3_000, fallbackSettleMs: 500
    })
    const audits = new PostgresAuditRepository(db)
    violations = new PostgresViolationRepository(db)
    sut = new DbRunAudit(audits, audits, violations, auditor)
  }, 60_000)

  afterAll(async () => {
    await auditor.close()
    await server.close()
    await db.destroy()
  })

  const queueAudit = async (url: string): Promise<string> => {
    const row = await db.insertInto('audits')
      .values({ page_id: null, url, status: 'queued' })
      .returning('id').executeTakeFirstOrThrow()
    return row.id
  }

  const load = async (id: string) =>
    await db.selectFrom('audits').selectAll().where('id', '=', id).executeTakeFirstOrThrow()

  const params = (auditId: string, isFinalAttempt = false) => ({
    auditId, signal: new AbortController().signal, isFinalAttempt
  })

  it('takes a queued audit to done, with violations and counts stored', async () => {
    const auditId = await queueAudit(server.baseUrl)

    await sut.run(params(auditId))

    const audit = await load(auditId)
    expect(audit.status).toBe('done')
    expect(audit.settled).toBe(true)
    expect(audit.axe_version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(audit.duration_ms).toBeGreaterThan(0)
    expect(audit.completed_at).toBeInstanceOf(Date)
    // Scoring is #6; this worker never writes one.
    expect(audit.score).toBeNull()

    const violations = await db.selectFrom('violations').selectAll()
      .where('audit_id', '=', auditId).execute()
    const ruleIds = violations.map((violation) => violation.rule_id)
    expect(ruleIds).toContain('image-alt')
    expect(ruleIds).toContain('label')

    // jsonb reorders keys, so compare structurally rather than as JSON text.
    const counts = audit.counts_by_impact
    expect(Object.keys(counts).sort()).toEqual(['critical', 'minor', 'moderate', 'serious'])
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
    const nodeTotal = violations.reduce((sum, violation) => sum + violation.nodes.length, 0)
    expect(total).toBe(nodeTotal)

    // nodes survive the jsonb round trip as objects, not a Postgres array literal
    expect(violations[0]?.nodes[0]).toEqual({
      target: expect.any(Array), html: expect.any(String)
    })
  }, 60_000)

  it('replaces violations rather than appending them when a job is redelivered', async () => {
    // A queue redelivers after a lost acknowledgement. Without a replace, the
    // same rules would be inserted twice and every count derived from them
    // would be inflated - `violations` has no uniqueness constraint to catch it.
    const auditId = await queueAudit(server.baseUrl)
    await sut.run(params(auditId))
    const first = await violations.loadByAuditId(auditId)

    // Re-run the persistence exactly as a redelivered attempt would.
    await violations.replaceAll(auditId, first.map((violation) => ({
      ruleId: violation.ruleId,
      impact: violation.impact,
      description: violation.description,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes
    })))

    const second = await violations.loadByAuditId(auditId)
    expect(second).toHaveLength(first.length)
    expect(second.map((v) => v.ruleId).sort()).toEqual(first.map((v) => v.ruleId).sort())
  }, 60_000)

  it('leaves a finished audit untouched when the queue redelivers it', async () => {
    const auditId = await queueAudit(server.baseUrl)
    await sut.run(params(auditId))
    const finished = await load(auditId)

    await sut.run(params(auditId))

    const after = await load(auditId)
    expect(after.completed_at).toEqual(finished.completed_at)
    expect(after.duration_ms).toBe(finished.duration_ms)
  }, 60_000)

  it('completes a page that never settles, flagged rather than failed', async () => {
    const auditId = await queueAudit(`${server.baseUrl}/never-idle`)

    await sut.run(params(auditId))

    const audit = await load(auditId)
    expect(audit.status).toBe('done')
    expect(audit.settled).toBe(false)
  }, 60_000)

  it('fails a dead address permanently, with a message a user can act on', async () => {
    const auditId = await queueAudit('http://127.0.0.1:45999/')

    await expect(sut.run(params(auditId))).rejects.toThrow(PermanentAuditError)

    const audit = await load(auditId)
    expect(audit.status).toBe('failed')
    expect(audit.error).toBe('Nothing responded at that address')
    expect(audit.completed_at).toBeInstanceOf(Date)
  }, 60_000)

  it('hands the audit back after a retryable failure, and the retry completes it', async () => {
    // The regression this pins, end to end and against the real repository: a
    // retryable failure writes no terminal status, so if the claim were kept
    // the row would sit in `running` holding a live lease. The queue's retry
    // arrives seconds later, far inside a ten minute lease, fails to claim,
    // finds nothing to do, reports success - and the audit is stranded in
    // `running` for ever, with no result and no error.
    const auditId = await queueAudit(server.baseUrl)
    const aborted = new AbortController()
    aborted.abort()

    // Attempt 1: fails transiently, with attempts still remaining.
    await expect(sut.run({ auditId, signal: aborted.signal, isFinalAttempt: false }))
      .rejects.toThrow()

    const betweenAttempts = await load(auditId)
    expect(betweenAttempts.status).toBe('queued')
    expect(betweenAttempts.claimed_at).toBeNull()

    // Attempt 2: the queue's retry, which must be able to claim and finish.
    await sut.run(params(auditId))

    const finished = await load(auditId)
    expect(finished.status).toBe('done')
    expect(finished.completed_at).toBeInstanceOf(Date)
    expect(
      await db.selectFrom('violations').select('id').where('audit_id', '=', auditId).execute()
    ).not.toHaveLength(0)
  }, 60_000)

  it('keeps a permanently failed audit terminal rather than releasing it', async () => {
    const auditId = await queueAudit('http://127.0.0.1:45999/')

    await expect(sut.run(params(auditId))).rejects.toThrow(PermanentAuditError)

    const failed = await load(auditId)
    expect(failed.status).toBe('failed')
    // A released claim here would invite another delivery to re-run a
    // finished audit.
    expect(await sut.run(params(auditId))).toBeUndefined()
    expect((await load(auditId)).status).toBe('failed')
  }, 60_000)
})
