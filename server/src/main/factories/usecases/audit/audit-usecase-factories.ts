import { DbLoadAuditResult } from '../../../../data/usecases/load-audit-result/db-load-audit-result.js'
import { DbRequestAudit } from '../../../../data/usecases/request-audit/db-request-audit.js'
import type { AuditJob } from '../../../../data/protocols/queue/audit-job-queue.js'
import type { LoadAuditResult } from '../../../../domain/usecases/load-audit-result.js'
import type { RequestAudit } from '../../../../domain/usecases/request-audit.js'
import { PostgresAuditRepository } from '../../../../infra/db/postgres/audit/postgres-audit-repository.js'
import { PostgresViolationRepository } from '../../../../infra/db/postgres/violation/postgres-violation-repository.js'
import { BullMqAuditQueue } from '../../../../infra/queue/bullmq-job-queue.js'
import { makeQueue } from '../../../../infra/queue/helpers/bullmq-helper.js'
import { NodeDnsResolver } from '../../../../infra/net/node-dns-resolver.js'
import { DEFAULT_URL_POLICY } from '../../../../infra/net/ip-address-policy.js'
import { getDatabase } from '../../../config/database.js'
import { env } from '../../../config/env.js'
import { QUEUE_NAMES } from '../../../config/queue-names.js'

/**
 * One queue for the process. A Queue holds a Redis connection, so building one
 * per request would open a connection per request - the same reason the
 * auditor owns a single browser rather than launching one per job.
 */
let auditQueue: BullMqAuditQueue | null = null

const getAuditQueue = (): BullMqAuditQueue => {
  if (auditQueue === null) {
    const queue = makeQueue<AuditJob>(QUEUE_NAMES.audit, env.redisUrl)

    // A Queue emits 'error' when its Redis connection fails. Without a
    // listener those go unreported, and an EventEmitter with no 'error'
    // handler is a hazard the API process should not carry - the intended
    // answer to a queue outage is a 503, not a surprise.
    queue.on('error', (error) => {
      console.error('Audit queue error (Redis connection):', error)
    })

    auditQueue = new BullMqAuditQueue(queue)
  }
  return auditQueue
}

export const makeRequestAudit = (): RequestAudit => {
  const audits = new PostgresAuditRepository(getDatabase())
  // The policy is injected rather than defaulted inside the usecase: data/
  // must not name the concrete rule set, and a default there would have been
  // a `node:net` import in the layer that is supposed to be free of the
  // runtime. The composition root is where a concrete belongs.
  return new DbRequestAudit(
    audits, audits, getAuditQueue(), new NodeDnsResolver(), DEFAULT_URL_POLICY
  )
}

export const makeLoadAuditResult = (): LoadAuditResult => new DbLoadAuditResult(
  new PostgresAuditRepository(getDatabase()),
  new PostgresViolationRepository(getDatabase())
)
