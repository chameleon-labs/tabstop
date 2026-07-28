import express, { type Express } from 'express'
import { setupErrorHandling, setupMiddlewares } from './middlewares.js'
import { setupRoutes } from './routes.js'

export const setupApp = (): Express => {
  const app = express()
  setupMiddlewares(app)
  setupRoutes(app)
  setupErrorHandling(app)
  return app
}
