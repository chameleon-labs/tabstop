import { PermanentAuditError } from '../../../domain/errors/permanent-audit-error.js'
import type { CountsByImpact } from '../../../domain/models/impact.js'
import type { RunAudit, RunAuditParams } from '../../../domain/usecases/run-audit.js'
import type { PageAuditor } from '../../protocols/audit/page-auditor.js'
import type {
  LoadAuditByIdRepository
} from '../../protocols/db/audit/load-audit-by-id-repository.js'
import type { MarkDoneRepository } from '../../protocols/db/audit/mark-done-repository.js'
import type { MarkFailedRepository } from '../../protocols/db/audit/mark-failed-repository.js'
import type { MarkRunningRepository } from '../../protocols/db/audit/mark-running-repository.js'
import type {
  AddViolationParams, AddViolationsRepository
} from '../../protocols/db/violation/add-violations-repository.js'
import { classifyAuditError } from './audit-error.js'

/**
 * Every key present, zeros included: `counts_by_impact` carries a check
 * constraint requiring all four, so a partial record is rejected outright.
 */
const countByImpact = (violations: AddViolationParams[]): CountsByImpact => {
  const counts: CountsByImpact = { minor: 0, moderate: 0, serious: 0, critical: 0 }
  for (const violation of violations) {
    counts[violation.impact] += violation.nodes.length
  }
  return counts
}

export type AuditStatusRepository =
  MarkRunningRepository & MarkDoneRepository & MarkFailedRepository

export class DbRunAudit implements RunAudit {
  constructor (
    private readonly loadAuditByIdRepository: LoadAuditByIdRepository,
    private readonly auditStatusRepository: AuditStatusRepository,
    private readonly addViolationsRepository: AddViolationsRepository,
    private readonly pageAuditor: PageAuditor
  ) {}

  async run ({ auditId, signal, isFinalAttempt }: RunAuditParams): Promise<void> {
    const audit = await this.loadAuditByIdRepository.loadById(auditId)
    // Retrying cannot conjure the row back, so this is permanent by definition.
    if (audit === null) throw new PermanentAuditError(`Audit ${auditId} no longer exists`)

    await this.auditStatusRepository.markRunning(auditId)

    try {
      const result = await this.pageAuditor.audit(audit.url, signal)

      await this.addViolationsRepository.addMany(auditId, result.violations)
      await this.auditStatusRepository.markDone(auditId, {
        countsByImpact: countByImpact(result.violations),
        axeVersion: result.axeVersion,
        durationMs: result.durationMs,
        settled: result.settled
      })
    } catch (error) {
      const failure = classifyAuditError(error)

      // A transient failure with attempts remaining must NOT write `failed`, or
      // the row flaps failed -> running -> failed in front of the user while
      // the queue is still working on it.
      if (failure.permanent || isFinalAttempt) {
        await this.auditStatusRepository.markFailed(auditId, failure.message)
      }

      if (failure.permanent) throw new PermanentAuditError(failure.message)
      throw error
    }
  }
}
