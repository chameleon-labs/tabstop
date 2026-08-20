import {DbLoadAuditResult} from '../../../../data/usecases/load-audit-result/db-load-audit-result.js';
import {DbRequestAudit} from '../../../../data/usecases/request-audit/db-request-audit.js';
import {DbRequestPageAudit} from '../../../../data/usecases/audit/db-request-page-audit.js';
import type {LoadAuditResult} from '../../../../domain/usecases/load-audit-result.js';
import {PostgresAuditRepository} from '../../../../infra/db/postgres/audit/postgres-audit-repository.js';
import {PostgresViolationRepository} from '../../../../infra/db/postgres/violation/postgres-violation-repository.js';
import {NodeDnsResolver} from '../../../../infra/net/node-dns-resolver.js';
import {DEFAULT_URL_POLICY} from '../../../../infra/net/ip-address-policy.js';
import {getDatabase} from '../../../config/database.js';
import {env} from '../../../config/env.js';
import type {AuditJobQueue} from '../../../../data/protocols/queue/audit-job-queue.js';

export const makeRequestAudit = (auditQueue: AuditJobQueue): DbRequestAudit => {
  const audits = new PostgresAuditRepository(getDatabase());
  // The policy is injected rather than defaulted inside the usecase: data/
  // must not name the concrete rule set, and a default there would have been
  // a `node:net` import in the layer that is supposed to be free of the
  // runtime. The composition root is where a concrete belongs - and the same
  // goes for the queue cap, which is operator configuration.
  return new DbRequestAudit(
    audits,
    audits,
    auditQueue,
    new NodeDnsResolver(),
    DEFAULT_URL_POLICY,
    env.auditQueueMaxDepth,
  );
};

export const makeRequestPageAudit = (auditQueue: AuditJobQueue): DbRequestPageAudit => {
  const audits = new PostgresAuditRepository(getDatabase());
  // No DNS resolver and no url policy, unlike the anonymous endpoint. The url
  // is not user input here - it is a page the account already tracks, checked
  // when it was added - and the worker's own gate re-resolves at fetch time,
  // which is the only check that can still be true by then.
  return new DbRequestPageAudit(audits, audits, auditQueue, env.auditQueueMaxDepth);
};

export const makeLoadAuditResult = (): LoadAuditResult =>
  new DbLoadAuditResult(new PostgresAuditRepository(getDatabase()), new PostgresViolationRepository(getDatabase()));
