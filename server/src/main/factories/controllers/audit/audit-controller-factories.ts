import {
  LoadAuditResultController,
  type LoadAuditResultRequest,
} from '../../../../presentation/controllers/audit/load-audit-result-controller.js';
import {RequestAuditController} from '../../../../presentation/controllers/audit/request-audit-controller.js';
import {RequestPageAuditController} from '../../../../presentation/controllers/audit/request-page-audit-controller.js';
import type {Controller} from '../../../../presentation/protocols/controller.js';
import type {AuditJobQueue} from '../../../../data/protocols/queue/audit-job-queue.js';
import {
  makeLoadAuditResult,
  makeRequestAudit,
  makeRequestPageAudit,
} from '../../usecases/audit/audit-usecase-factories.js';

export const makeRequestAuditController = (auditQueue: AuditJobQueue): RequestAuditController =>
  new RequestAuditController(makeRequestAudit(auditQueue));

export const makeRequestPageAuditController = (auditQueue: AuditJobQueue): RequestPageAuditController =>
  new RequestPageAuditController(makeRequestPageAudit(auditQueue));

export const makeLoadAuditResultController = (): Controller<LoadAuditResultRequest> =>
  new LoadAuditResultController(makeLoadAuditResult());
