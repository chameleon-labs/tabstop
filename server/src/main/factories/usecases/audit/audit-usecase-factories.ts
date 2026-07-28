import { DbLoadAuditResult } from '../../../../data/usecases/load-audit-result/db-load-audit-result.js'
import { DbRequestAudit, type AuditJob } from '../../../../data/usecases/request-audit/db-request-audit.js'
import type { LoadAuditResult } from '../../../../domain/usecases/load-audit-result.js'
import type { RequestAudit } from '../../../../domain/usecases/request-audit.js'
import { PostgresAuditRepository } from '../../../../infra/db/postgres/audit/postgres-audit-repository.js'
import { PostgresViolationRepository } from '../../../../infra/db/postgres/violation/postgres-violation-repository.js'
import { BullMqJobQueue } from '../../../../infra/queue/bullmq-job-queue.js'
import { makeQueue } from '../../../../infra/queue/helpers/bullmq-helper.js'
import { getDatabase } from '../../../config/database.js'
import { env } from '../../../config/env.js'
import { QUEUE_NAMES } from '../../../config/queue-names.js'

/**
 * One queue for the process. A Queue holds a Redis connection, so building one
 * per request would open a connection per request - the same reason the
 * auditor owns a single browser rather than launching one per job.
 */
let auditQueue: BullMqJobQueue<AuditJob> | null = null

const getAuditQueue = (): BullMqJobQueue<AuditJob> => {
  auditQueue ??= new BullMqJobQueue<AuditJob>(
    makeQueue<AuditJob>(QUEUE_NAMES.audit, env.redisUrl)
  )
  return auditQueue
}

export const makeRequestAudit = (): RequestAudit => {
  const audits = new PostgresAuditRepository(getDatabase())
  return new DbRequestAudit(audits, audits, getAuditQueue())
}

export const makeLoadAuditResult = (): LoadAuditResult => new DbLoadAuditResult(
  new PostgresAuditRepository(getDatabase()),
  new PostgresViolationRepository(getDatabase())
)
