import express, { type Express } from 'express'
import { setupMiddlewares } from './middlewares.js'
import { setupRoutes } from './routes.js'

export const setupApp = (): Express => {
  const app = express()
  setupMiddlewares(app)
  setupRoutes(app)
  return app
}
