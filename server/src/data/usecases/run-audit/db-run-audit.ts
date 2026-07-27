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
import type { AddViolationParams } from '../../protocols/db/violation/violation-params.js'
import type {
  ReplaceViolationsRepository
} from '../../protocols/db/violation/replace-violations-repository.js'
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
    private readonly replaceViolationsRepository: ReplaceViolationsRepository,
    private readonly pageAuditor: PageAuditor
  ) {}

  async run ({ auditId, signal, isFinalAttempt }: RunAuditParams): Promise<void> {
    const audit = await this.loadAuditByIdRepository.loadById(auditId)
    // Retrying cannot conjure the row back, so this is permanent by definition.
    if (audit === null) throw new PermanentAuditError(`Audit ${auditId} no longer exists`)

    // A queue redelivers - after a lost acknowledgement, or a process that
    // died between finishing the work and reporting it. Re-running a finished
    // audit would overwrite a completed result with a second, differently-timed
    // one, so an audit that already reached a terminal state is left alone.
    if (audit.status === 'done' || audit.status === 'failed') return

    await this.auditStatusRepository.markRunning(auditId)

    try {
      const result = await this.pageAuditor.audit(audit.url, signal)

      // Replace rather than append: the queue can redeliver after violations
      // were committed but before the audit was marked done, and `violations`
      // has no uniqueness constraint to catch a second insert of the same
      // rules. Replacing makes the write safe to repeat.
      await this.replaceViolationsRepository.replaceAll(auditId, result.violations)
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
