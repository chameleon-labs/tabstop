import { DbRunAudit } from '../../../../data/usecases/run-audit/db-run-audit.js'
import type { RunAudit } from '../../../../domain/usecases/run-audit.js'
import { PlaywrightAxeAuditor } from '../../../../infra/audit/playwright-axe-auditor.js'
import { PostgresAuditRepository } from '../../../../infra/db/postgres/audit/postgres-audit-repository.js'
import { PostgresViolationRepository } from '../../../../infra/db/postgres/violation/postgres-violation-repository.js'
import { getDatabase } from '../../../config/database.js'
import { env } from '../../../config/env.js'

/**
 * One auditor for the process, because it owns the shared browser. Building a
 * new one per job would launch a new Chromium per job and leak the old ones.
 */
let auditor: PlaywrightAxeAuditor | null = null

export const getPageAuditor = (): PlaywrightAxeAuditor => {
  auditor ??= new PlaywrightAxeAuditor({
    navigationMs: env.auditNavigationTimeoutMs,
    settleMs: env.auditSettleBudgetMs,
    fallbackSettleMs: env.auditFallbackSettleMs
  })
  return auditor
}

export const closePageAuditor = async (): Promise<void> => {
  await auditor?.close()
  auditor = null
}

export const makeRunAudit = (): RunAudit => {
  const audits = new PostgresAuditRepository(getDatabase())
  return new DbRunAudit(
    audits,
    audits,
    new PostgresViolationRepository(getDatabase()),
    getPageAuditor()
  )
}
