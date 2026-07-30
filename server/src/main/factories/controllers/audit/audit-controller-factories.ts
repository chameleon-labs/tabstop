import {
  LoadAuditResultController, type LoadAuditResultRequest
} from '../../../../presentation/controllers/audit/load-audit-result-controller.js'
import {
  RequestAuditController, type RequestAuditRequest
} from '../../../../presentation/controllers/audit/request-audit-controller.js'
import type { Controller } from '../../../../presentation/protocols/controller.js'
import { makeLoadAuditResult, makeRequestAudit } from '../../usecases/audit/audit-usecase-factories.js'

export const makeRequestAuditController = (): Controller<RequestAuditRequest> =>
  new RequestAuditController(makeRequestAudit())

export const makeLoadAuditResultController = (): Controller<LoadAuditResultRequest> =>
  new LoadAuditResultController(makeLoadAuditResult())
