import type { Router } from 'express'
import { env } from '../config/env.js'
import { adaptRoute } from '../adapters/express-route-adapter.js'
import {
  makeLoadAuditResultController, makeRequestAuditController
} from '../factories/controllers/audit/audit-controller-factories.js'

export default (router: Router): void => {
  // Off unless explicitly enabled. These endpoints are anonymous by design - a
  // one-off audit with no signup is the product's hook - and until #8 adds
  // rate limiting there is nothing stopping one caller consuming every worker
  // slot at roughly thirty seconds of Chromium each. A comment cannot prevent
  // a deploy; an absent route can.
  if (!env.auditApiEnabled) return

  router.post('/audits', adaptRoute(makeRequestAuditController()))

  // Fully public, gated only by an unguessable uuid. The payload is built by
  // an explicit mapper so nothing user-identifying can ride along.
  router.get('/audits/:uuid', adaptRoute(makeLoadAuditResultController()))
}
