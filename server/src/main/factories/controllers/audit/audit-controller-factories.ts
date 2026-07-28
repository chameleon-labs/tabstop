import {
  LoadAuditResultController
} from '../../../../presentation/controllers/audit/load-audit-result-controller.js'
import {
  RequestAuditController
} from '../../../../presentation/controllers/audit/request-audit-controller.js'
import type { Controller } from '../../../../presentation/protocols/controller.js'
import { makeLoadAuditResult, makeRequestAudit } from '../../usecases/audit/audit-usecase-factories.js'

export const makeRequestAuditController = (): Controller =>
  new RequestAuditController(makeRequestAudit()) as Controller

export const makeLoadAuditResultController = (): Controller =>
  new LoadAuditResultController(makeLoadAuditResult()) as Controller
