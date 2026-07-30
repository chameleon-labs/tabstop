import { PermanentAuditError } from '../../../domain/errors/permanent-audit-error.js'
import type { RunAudit, RunAuditParams } from '../../../domain/usecases/run-audit.js'
import { summariseViolations } from '../../../domain/services/score.js'
import type { PageAuditor } from '../../protocols/audit/page-auditor.js'
import type {
  LoadAuditByIdRepository
} from '../../protocols/db/audit/load-audit-by-id-repository.js'
import type {
  CompleteAuditRepository
} from '../../protocols/db/audit/complete-audit-repository.js'
import type { MarkFailedRepository } from '../../protocols/db/audit/mark-failed-repository.js'
import type { MarkRunningRepository } from '../../protocols/db/audit/mark-running-repository.js'
import type {
  ReplaceViolationsRepository
} from '../../protocols/db/violation/replace-violations-repository.js'
import { classifyAuditError } from './audit-error.js'

export type AuditStatusRepository =
  MarkRunningRepository & CompleteAuditRepository & MarkFailedRepository

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
    // died between finishing the work and reporting it. Claiming is a single
    // conditional update rather than a check followed by a write: between
    // reading the row above and claiming it, another delivery can finish the
    // same audit, and a plain update would then resurrect it into `running`
    // and overwrite the completed result with a second, later one.
    const claimedAt = await this.auditStatusRepository.claimForRun(auditId)
    if (claimedAt === null) {
      // Not claimable, for two very different reasons - and acknowledging both
      // is wrong. A finished audit is genuinely nothing to do. One still held
      // by a live claim is not: the attempt holding it may yet die without
      // writing a terminal status, and if this job acknowledges now, nothing
      // will ever pick the audit up again. Failing keeps it on the queue.
      const current = await this.loadAuditByIdRepository.loadById(auditId)
      if (current === null || current.status === 'done' || current.status === 'failed') return

      throw new Error(`Audit ${auditId} is held by another attempt`)
    }

    try {
      const result = await this.pageAuditor.audit(audit.url, signal)

      // Replace rather than append: the queue can redeliver after violations
      // were committed but before the audit was marked done, and `violations`
      // has no uniqueness constraint to catch a second insert of the same
      // rules. Replacing makes the write safe to repeat.
      await this.replaceViolationsRepository.replaceAll(auditId, claimedAt, result.violations)

      const summary = summariseViolations(result.violations.map(
        ({ ruleId, impact, nodes }) => ({ ruleId, impact, nodeCount: nodes.length })
      ))

      await this.auditStatusRepository.complete(auditId, claimedAt, {
        ...summary,
        axeVersion: result.axeVersion,
        durationMs: result.durationMs,
        settled: result.settled,
        // Regression identity is rule-level. Display copy and nodes are
        // already persisted, while these are the only fields comparison uses.
        violations: result.violations.map(({ ruleId, impact }) => ({ ruleId, impact }))
      })
    } catch (error) {
      const failure = classifyAuditError(error)

      // A transient failure with attempts remaining must NOT write `failed`, or
      // the row flaps failed -> running -> failed in front of the user while
      // the queue is still working on it.
      if (failure.permanent || isFinalAttempt) {
        await this.auditStatusRepository.markFailed(auditId, claimedAt, failure.message)
      } else {
        // Retryable, and no terminal status was written - so the claim has to
        // go back. Holding it would leave the row `running` with a live lease
        // that the queue's own retry, arriving seconds later, could not claim:
        // that attempt would find nothing to do, report success, and strand
        // the audit in `running` permanently.
        await this.auditStatusRepository.releaseClaim(auditId, claimedAt)
      }

      if (failure.permanent) throw new PermanentAuditError(failure.message)
      throw error
    }
  }
}
