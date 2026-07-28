import { Router, type Express } from 'express'
import setupAccountRoutes from '../routes/account-routes.js'
import setupAuditRoutes from '../routes/audit-routes.js'
import setupHealthCheckRoutes from '../routes/health-check-routes.js'

export const setupRoutes = (app: Express): void => {
  const router = Router()
  app.use('/api', router)

  setupHealthCheckRoutes(router)
  setupAccountRoutes(router)
  setupAuditRoutes(router)
}
