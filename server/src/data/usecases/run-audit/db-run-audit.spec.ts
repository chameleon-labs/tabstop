import { describe, expect, it } from 'vitest'
import { DbRunAudit } from './db-run-audit.js'
import { PermanentAuditError } from '../../../domain/errors/permanent-audit-error.js'
import type { RunAuditParams } from '../../../domain/usecases/run-audit.js'
import {
  mockAuditStatusRepository,
  mockAuditModel, mockLoadAuditByIdRepository, mockPageAuditor, mockReplaceViolationsRepository
} from '../../test/index.js'

const makeSut = () => {
  const loadAudit = mockLoadAuditByIdRepository()
  const auditStatus = mockAuditStatusRepository()
  const violations = mockReplaceViolationsRepository()
  const pageAuditor = mockPageAuditor()
  const sut = new DbRunAudit(loadAudit, auditStatus, violations, pageAuditor)
  return { sut, loadAudit, auditStatus, violations, pageAuditor }
}

const params = (overrides: Partial<RunAuditParams> = {}): RunAuditParams => ({
  auditId: 'audit-1',
  signal: new AbortController().signal,
  isFinalAttempt: false,
  ...overrides
})

describe('DbRunAudit', () => {
  it('marks running, stores violations, then marks done', async () => {
    const { sut, auditStatus, violations } = makeSut()

    await sut.run(params())

    expect(auditStatus.claimForRun).toHaveBeenCalledWith('audit-1')
    expect(violations.replaceAll).toHaveBeenCalledWith('audit-1', new Date('2026-07-27T10:00:00Z'), expect.any(Array))
    expect(auditStatus.markDone).toHaveBeenCalledWith('audit-1', new Date('2026-07-27T10:00:00Z'), {
      // (10 x 2 critical) + (5 x 1 serious) = 25 deducted.
      score: 75,
      // counted per NODE, not per rule: two alt-less images are two problems
      countsByImpact: { minor: 0, moderate: 0, serious: 1, critical: 2 },
      axeVersion: '4.12.1',
      durationMs: 1234,
      settled: true
    })
    expect(auditStatus.markFailed).not.toHaveBeenCalled()
  })

  it('scores a clean page at 100', async () => {
    const { sut, auditStatus, pageAuditor } = makeSut()
    pageAuditor.audit.mockResolvedValueOnce({
      violations: [], axeVersion: '4.12.1', durationMs: 5, settled: true
    })

    await sut.run(params())

    expect(auditStatus.markDone.mock.calls[0]?.[2].score).toBe(100)
  })

  it('audits the URL from the loaded audit row', async () => {
    const { sut, pageAuditor } = makeSut()
    const signal = new AbortController().signal

    await sut.run(params({ signal }))

    expect(pageAuditor.audit).toHaveBeenCalledWith('https://example.test/a', signal)
  })

  it('writes all four impact keys for a clean page', async () => {
    // The check constraint rejects a partial record, so zero counts still have
    // to be spelled out in full.
    const { sut, auditStatus, pageAuditor } = makeSut()
    pageAuditor.audit.mockResolvedValueOnce({
      violations: [], axeVersion: '4.12.1', durationMs: 5, settled: true
    })

    await sut.run(params())

    expect(auditStatus.markDone.mock.calls[0]?.[2].countsByImpact)
      .toEqual({ minor: 0, moderate: 0, serious: 0, critical: 0 })
  })

  it('persists a violation with no severity but leaves it out of the counts', async () => {
    const { sut, auditStatus, violations, pageAuditor } = makeSut()
    pageAuditor.audit.mockResolvedValueOnce({
      violations: [
        {
          ruleId: 'no-impact-rule',
          impact: null,
          description: 'No severity',
          helpUrl: 'https://example.test/rule',
          nodes: [{ target: ['div'], html: '<div>' }]
        },
        {
          ruleId: 'image-alt',
          impact: 'critical',
          description: 'Images must have alternate text',
          helpUrl: 'https://example.test/image-alt',
          nodes: [{ target: ['img'], html: '<img>' }]
        }
      ],
      axeVersion: '4.12.1',
      durationMs: 10,
      settled: true
    })

    await sut.run(params())

    // Both are stored...
    expect(violations.replaceAll.mock.calls[0]?.[2]).toHaveLength(2)
    // ...but only the one with a severity is counted. Inventing a bucket for
    // the other would corrupt the comparison regression detection makes.
    expect(auditStatus.markDone.mock.calls[0]?.[2].countsByImpact)
      .toEqual({ minor: 0, moderate: 0, serious: 0, critical: 1 })
  })

  it('records an unsettled page as done rather than failed', async () => {
    const { sut, auditStatus, pageAuditor } = makeSut()
    pageAuditor.audit.mockResolvedValueOnce({
      violations: [], axeVersion: '4.12.1', durationMs: 9, settled: false
    })

    await sut.run(params())

    expect(auditStatus.markDone.mock.calls[0]?.[2].settled).toBe(false)
    expect(auditStatus.markFailed).not.toHaveBeenCalled()
  })

  it('marks failed and raises PermanentAuditError for a permanent failure', async () => {
    const { sut, auditStatus, pageAuditor } = makeSut()
    pageAuditor.audit.mockRejectedValueOnce(
      new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at http://x/')
    )

    await expect(sut.run(params())).rejects.toThrow(PermanentAuditError)
    expect(auditStatus.markFailed).toHaveBeenCalledWith('audit-1', new Date('2026-07-27T10:00:00Z'), 'Could not resolve that domain')
  })

  it('does not mark failed for a transient failure while attempts remain', async () => {
    // Writing `failed` here would flap the row failed -> running -> failed
    // while the queue is still retrying.
    const { sut, auditStatus, pageAuditor } = makeSut()
    pageAuditor.audit.mockRejectedValueOnce(new Error('some transient blip'))

    await expect(sut.run(params({ isFinalAttempt: false }))).rejects.toThrow('some transient blip')
    expect(auditStatus.markFailed).not.toHaveBeenCalled()
  })

  it('hands the claim back when a transient failure will be retried', async () => {
    // Without this the row sits in `running` holding a live lease, and the
    // queue's retry - arriving seconds later, far inside a ten minute lease -
    // cannot claim it. That attempt finds nothing to do, reports success, and
    // the audit is stranded in `running` for good.
    const { sut, auditStatus, pageAuditor } = makeSut()
    pageAuditor.audit.mockRejectedValueOnce(new Error('some transient blip'))

    await expect(sut.run(params({ isFinalAttempt: false }))).rejects.toThrow('some transient blip')

    expect(auditStatus.releaseClaim)
      .toHaveBeenCalledWith('audit-1', new Date('2026-07-27T10:00:00Z'))
  })

  it('keeps the claim when a permanent failure ends the audit', async () => {
    // Nothing will retry it, and the row is terminal, so handing the claim
    // back would only invite another delivery to re-run a finished audit.
    const { sut, auditStatus, pageAuditor } = makeSut()
    pageAuditor.audit.mockRejectedValueOnce(
      new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at http://x/')
    )

    await expect(sut.run(params())).rejects.toThrow(PermanentAuditError)

    expect(auditStatus.releaseClaim).not.toHaveBeenCalled()
  })

  it('marks failed for a transient failure on the final attempt', async () => {
    const { sut, auditStatus, pageAuditor } = makeSut()
    pageAuditor.audit.mockRejectedValueOnce(new Error('some transient blip'))

    await expect(sut.run(params({ isFinalAttempt: true }))).rejects.toThrow('some transient blip')
    expect(auditStatus.markFailed)
      .toHaveBeenCalledWith('audit-1', new Date('2026-07-27T10:00:00Z'), 'Something went wrong running this audit')
    // Terminal, so there is nothing to hand back.
    expect(auditStatus.releaseClaim).not.toHaveBeenCalled()
  })

  it('rethrows a transient failure unchanged, so the queue can retry it', async () => {
    const { sut, pageAuditor } = makeSut()
    const original = new Error('some transient blip')
    pageAuditor.audit.mockRejectedValueOnce(original)

    await expect(sut.run(params())).rejects.toBe(original)
  })

  it('acknowledges an unclaimable audit that has already finished', async () => {
    for (const status of ['done', 'failed'] as const) {
      const { sut, loadAudit, auditStatus, violations, pageAuditor } = makeSut()
      auditStatus.claimForRun.mockResolvedValueOnce(null)
      loadAudit.loadById
        .mockResolvedValueOnce(mockAuditModel())
        .mockResolvedValueOnce({ ...mockAuditModel(), status })

      await sut.run(params())

      expect(pageAuditor.audit).not.toHaveBeenCalled()
      expect(violations.replaceAll).not.toHaveBeenCalled()
      expect(auditStatus.markDone).not.toHaveBeenCalled()
      expect(auditStatus.markFailed).not.toHaveBeenCalled()
    }
  })

  it('refuses to acknowledge an audit still held by a live claim', async () => {
    // Acknowledging here loses the audit: the attempt holding the claim may
    // still die without writing a terminal status - after runWithTimeout's
    // bounded grace, or because its own release failed - and nothing would
    // ever pick it up again. Failing keeps the job on the queue.
    const { sut, loadAudit, auditStatus, pageAuditor } = makeSut()
    auditStatus.claimForRun.mockResolvedValueOnce(null)
    loadAudit.loadById
      .mockResolvedValueOnce(mockAuditModel())
      .mockResolvedValueOnce({ ...mockAuditModel(), status: 'running' })

    await expect(sut.run(params())).rejects.toThrow('held by another attempt')
    expect(pageAuditor.audit).not.toHaveBeenCalled()
  })

  it('runs an audit that was left in running by an earlier crash', async () => {
    const { sut, loadAudit, auditStatus } = makeSut()
    loadAudit.loadById.mockResolvedValueOnce({ ...mockAuditModel(), status: 'running' })

    await sut.run(params())

    expect(auditStatus.markDone).toHaveBeenCalled()
  })

  it('treats a missing audit as permanent without marking anything running', async () => {
    const { sut, loadAudit, auditStatus } = makeSut()
    loadAudit.loadById.mockResolvedValueOnce(null)

    await expect(sut.run(params())).rejects.toThrow(PermanentAuditError)
    expect(auditStatus.claimForRun).not.toHaveBeenCalled()
  })
})
