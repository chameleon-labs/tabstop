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

    expect(auditStatus.markRunning).toHaveBeenCalledWith('audit-1')
    expect(violations.replaceAll).toHaveBeenCalledWith('audit-1', expect.any(Array))
    expect(auditStatus.markDone).toHaveBeenCalledWith('audit-1', {
      // counted per NODE, not per rule: two alt-less images are two problems
      countsByImpact: { minor: 0, moderate: 0, serious: 1, critical: 2 },
      axeVersion: '4.12.1',
      durationMs: 1234,
      settled: true
    })
    expect(auditStatus.markFailed).not.toHaveBeenCalled()
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

    expect(auditStatus.markDone.mock.calls[0]?.[1].countsByImpact)
      .toEqual({ minor: 0, moderate: 0, serious: 0, critical: 0 })
  })

  it('records an unsettled page as done rather than failed', async () => {
    const { sut, auditStatus, pageAuditor } = makeSut()
    pageAuditor.audit.mockResolvedValueOnce({
      violations: [], axeVersion: '4.12.1', durationMs: 9, settled: false
    })

    await sut.run(params())

    expect(auditStatus.markDone.mock.calls[0]?.[1].settled).toBe(false)
    expect(auditStatus.markFailed).not.toHaveBeenCalled()
  })

  it('marks failed and raises PermanentAuditError for a permanent failure', async () => {
    const { sut, auditStatus, pageAuditor } = makeSut()
    pageAuditor.audit.mockRejectedValueOnce(
      new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at http://x/')
    )

    await expect(sut.run(params())).rejects.toThrow(PermanentAuditError)
    expect(auditStatus.markFailed).toHaveBeenCalledWith('audit-1', 'Could not resolve that domain')
  })

  it('does not mark failed for a transient failure while attempts remain', async () => {
    // Writing `failed` here would flap the row failed -> running -> failed
    // while the queue is still retrying.
    const { sut, auditStatus, pageAuditor } = makeSut()
    pageAuditor.audit.mockRejectedValueOnce(new Error('some transient blip'))

    await expect(sut.run(params({ isFinalAttempt: false }))).rejects.toThrow('some transient blip')
    expect(auditStatus.markFailed).not.toHaveBeenCalled()
  })

  it('marks failed for a transient failure on the final attempt', async () => {
    const { sut, auditStatus, pageAuditor } = makeSut()
    pageAuditor.audit.mockRejectedValueOnce(new Error('some transient blip'))

    await expect(sut.run(params({ isFinalAttempt: true }))).rejects.toThrow('some transient blip')
    expect(auditStatus.markFailed)
      .toHaveBeenCalledWith('audit-1', 'Something went wrong running this audit')
  })

  it('rethrows a transient failure unchanged, so the queue can retry it', async () => {
    const { sut, pageAuditor } = makeSut()
    const original = new Error('some transient blip')
    pageAuditor.audit.mockRejectedValueOnce(original)

    await expect(sut.run(params())).rejects.toBe(original)
  })

  it('skips an audit that already reached a terminal state', async () => {
    // The queue redelivers after a lost acknowledgement. Re-running a finished
    // audit would overwrite a completed result with a second, differently-timed
    // one - and re-insert its violations.
    for (const status of ['done', 'failed'] as const) {
      const { sut, loadAudit, auditStatus, violations, pageAuditor } = makeSut()
      loadAudit.loadById.mockResolvedValueOnce({ ...mockAuditModel(), status })

      await sut.run(params())

      expect(pageAuditor.audit).not.toHaveBeenCalled()
      expect(auditStatus.markRunning).not.toHaveBeenCalled()
      expect(violations.replaceAll).not.toHaveBeenCalled()
    }
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
    expect(auditStatus.markRunning).not.toHaveBeenCalled()
  })
})
