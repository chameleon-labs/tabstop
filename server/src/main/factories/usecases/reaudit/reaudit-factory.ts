import {
  DbRunScheduledReaudits
} from '../../../../data/usecases/reaudit/db-run-scheduled-reaudits.js'
import type { RunScheduledReaudits } from '../../../../domain/usecases/run-scheduled-reaudits.js'
import {
  PostgresAuditRepository
} from '../../../../infra/db/postgres/audit/postgres-audit-repository.js'
import { PostgresPageRepository } from '../../../../infra/db/postgres/page/postgres-page-repository.js'
import { getDatabase } from '../../../config/database.js'
import {
  IN_FLIGHT_GRACE_MS, MAX_PAGES_PER_RUN, REAUDIT_BATCH_SIZE
} from '../../../config/reaudit.js'
import { getAuditQueue } from '../../queue/audit-queue.js'

/**
 * The fan-out enqueues onto the SAME audit queue everything else does, so a
 * re-audit and a one-off submission are one kind of work with one concurrency
 * cap and one worker pool. A separate queue would give the cost backstop a
 * second ceiling to be under, which is not a ceiling.
 */
export const makeRunScheduledReaudits = (): RunScheduledReaudits => new DbRunScheduledReaudits(
  new PostgresPageRepository(getDatabase()),
  new PostgresAuditRepository(getDatabase()),
  new PostgresAuditRepository(getDatabase()),
  getAuditQueue(),
  REAUDIT_BATCH_SIZE,
  MAX_PAGES_PER_RUN,
  IN_FLIGHT_GRACE_MS
)
