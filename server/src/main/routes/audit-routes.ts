import type { Router } from 'express'
import { adaptRoute } from '../adapters/express-route-adapter.js'
import {
  makeLoadAuditResultController, makeRequestAuditController
} from '../factories/controllers/audit/audit-controller-factories.js'

export default (router: Router): void => {
  // Anonymous by design - a one-off audit with no signup is the product's
  // hook. It is also UNLIMITED until #8 lands, and each accepted request costs
  // roughly thirty seconds of Chromium, so it must not be deployed before then.
  router.post('/audits', adaptRoute(makeRequestAuditController()))

  // Fully public, gated only by an unguessable uuid. The payload is built by
  // an explicit mapper so nothing user-identifying can ride along.
  router.get('/audits/:uuid', adaptRoute(makeLoadAuditResultController()))
}
