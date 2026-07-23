import { Router, type Express } from 'express'
import setupHealthCheckRoutes from '../routes/health-check-routes.js'

export const setupRoutes = (app: Express): void => {
  const router = Router()
  app.use('/api', router)

  setupHealthCheckRoutes(router)
}
