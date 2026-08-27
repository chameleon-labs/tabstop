import {DbRunAudit} from '../../../../data/usecases/run-audit/db-run-audit.js';
import type {RunAudit} from '../../../../domain/usecases/run-audit.js';
import {PlaywrightAxeAuditor} from '../../../../infra/audit/playwright-axe-auditor.js';
import {NodeDnsResolver} from '../../../../infra/net/node-dns-resolver.js';
import {PostgresAuditRepository, claimLeaseFor} from '../../../../infra/db/postgres/audit/postgres-audit-repository.js';
import {JOB_UNWIND_GRACE_MS} from '../../../../infra/queue/run-with-timeout.js';
import {PostgresViolationRepository} from '../../../../infra/db/postgres/violation/postgres-violation-repository.js';
import {getDatabase} from '../../../config/database.js';
import {env} from '../../../config/env.js';

let auditor: PlaywrightAxeAuditor | null = null;

export const getPageAuditor = (): PlaywrightAxeAuditor => {
  auditor ??= new PlaywrightAxeAuditor(
    {
      navigationMs: env.auditNavigationTimeoutMs,
      settleMs: env.auditSettleBudgetMs,
      fallbackSettleMs: env.auditFallbackSettleMs,
    },
    new NodeDnsResolver(),
  );
  return auditor;
};

export const closePageAuditor = async (): Promise<void> => {
  await auditor?.close();
  auditor = null;
};

export const makeRunAudit = (): RunAudit => {
  const audits = new PostgresAuditRepository(getDatabase(), claimLeaseFor(env.auditJobTimeoutMs, JOB_UNWIND_GRACE_MS));
  return new DbRunAudit(audits, audits, new PostgresViolationRepository(getDatabase()), getPageAuditor());
};
