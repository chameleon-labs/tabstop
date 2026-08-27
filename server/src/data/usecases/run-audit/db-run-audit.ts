import {PermanentAuditError} from '../../../domain/errors/permanent-audit-error.js';
import type {RunAudit, RunAuditParams} from '../../../domain/usecases/run-audit.js';
import {summariseViolations} from '../../../domain/services/score.js';
import type {PageAuditor} from '../../protocols/audit/page-auditor.js';
import type {LoadAuditByIdRepository} from '../../protocols/db/audit/load-audit-by-id-repository.js';
import type {CompleteAuditRepository} from '../../protocols/db/audit/complete-audit-repository.js';
import type {MarkFailedRepository} from '../../protocols/db/audit/mark-failed-repository.js';
import type {MarkRunningRepository} from '../../protocols/db/audit/mark-running-repository.js';
import type {ReplaceViolationsRepository} from '../../protocols/db/violation/replace-violations-repository.js';
import {classifyAuditError} from './audit-error.js';

export type AuditStatusRepository = MarkRunningRepository & CompleteAuditRepository & MarkFailedRepository;

export class DbRunAudit implements RunAudit {
  constructor(
    private readonly loadAuditByIdRepository: LoadAuditByIdRepository,
    private readonly auditStatusRepository: AuditStatusRepository,
    private readonly replaceViolationsRepository: ReplaceViolationsRepository,
    private readonly pageAuditor: PageAuditor,
  ) {}

  async run({auditId, signal, isFinalAttempt}: RunAuditParams): Promise<void> {
    const audit = await this.loadAuditByIdRepository.loadById(auditId);
    if (audit === null) {
      throw new PermanentAuditError(`Audit ${auditId} no longer exists`);
    }

    const claimedAt = await this.auditStatusRepository.claimForRun(auditId);
    if (claimedAt === null) {
      const current = await this.loadAuditByIdRepository.loadById(auditId);
      if (current === null || current.status === 'done' || current.status === 'failed') {
        return;
      }

      throw new Error(`Audit ${auditId} is held by another attempt`);
    }

    try {
      const result = await this.pageAuditor.audit(audit.url, signal);

      await this.replaceViolationsRepository.replaceAll(auditId, claimedAt, result.violations);

      const summary = summariseViolations(
        result.violations.map(({ruleId, impact, nodes}) => ({ruleId, impact, nodeCount: nodes.length})),
      );

      await this.auditStatusRepository.complete(auditId, claimedAt, {
        ...summary,
        axeVersion: result.axeVersion,
        durationMs: result.durationMs,
        settled: result.settled,
        violations: result.violations.map(({ruleId, impact}) => ({ruleId, impact})),
      });
    } catch (error) {
      const failure = classifyAuditError(error);

      if (failure.permanent || isFinalAttempt) {
        await this.auditStatusRepository.markFailed(auditId, claimedAt, failure.message);
      } else {
        await this.auditStatusRepository.releaseClaim(auditId, claimedAt);
      }

      if (failure.permanent) {
        throw new PermanentAuditError(failure.message);
      }
      throw error;
    }
  }
}
