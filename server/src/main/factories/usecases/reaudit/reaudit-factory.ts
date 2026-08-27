import {DbRunScheduledReaudits} from '../../../../data/usecases/reaudit/db-run-scheduled-reaudits.js';
import type {RunScheduledReaudits} from '../../../../domain/usecases/run-scheduled-reaudits.js';
import {PostgresAuditRepository} from '../../../../infra/db/postgres/audit/postgres-audit-repository.js';
import {PostgresPageRepository} from '../../../../infra/db/postgres/page/postgres-page-repository.js';
import {getDatabase} from '../../../config/database.js';
import {MAX_PAGES_PER_RUN, REAUDIT_BATCH_SIZE, STALE_AFTER_MS} from '../../../config/reaudit.js';
import {getAuditQueue} from '../../queue/audit-queue.js';

export const makeRunScheduledReaudits = (): RunScheduledReaudits =>
  new DbRunScheduledReaudits(
    new PostgresPageRepository(getDatabase()),
    new PostgresAuditRepository(getDatabase()),
    new PostgresAuditRepository(getDatabase()),
    getAuditQueue(),
    REAUDIT_BATCH_SIZE,
    MAX_PAGES_PER_RUN,
    STALE_AFTER_MS,
  );
