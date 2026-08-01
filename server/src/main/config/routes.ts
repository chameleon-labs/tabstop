import { Router, type Express } from 'express'
import setupAccountRoutes from '../routes/account-routes.js'
import setupAuditRoutes from '../routes/audit-routes.js'
import setupHealthCheckRoutes from '../routes/health-check-routes.js'
import setupPageRoutes from '../routes/page-routes.js'
import setupAlertRoutes from '../routes/alert-routes.js'
import type { AppDependencies } from './app-dependencies.js'

export const setupRoutes = (app: Express, dependencies: AppDependencies): void => {
  const router = Router()
  app.use('/api', router)

  setupHealthCheckRoutes(router)
  setupAccountRoutes(router, dependencies.rateLimiter)
  setupAuditRoutes(router, dependencies.rateLimiter, dependencies.auditQueue)
  setupPageRoutes(router, dependencies.rateLimiter, dependencies.auditQueue)
  setupAlertRoutes(router, dependencies.rateLimiter)
}
