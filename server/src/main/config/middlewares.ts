import express, { type Express } from 'express'
import {
  cors, contentType, errorHandler, noStore, notFoundHandler, sameOrigin, securityHeaders
} from '../middlewares/index.js'

export const setupMiddlewares = (app: Express): void => {
  // Free reconnaissance on every response, including the ones no route
  // produced. Nothing needs it.
  app.disable('x-powered-by')

  app.use(cors)
  app.use(noStore)
  app.use(securityHeaders)
  app.use(sameOrigin)
  // RFC 8058 one-click unsubscribe is form-encoded, as is the browser
  // confirmation form. Keep its parser deliberately small.
  app.use(express.urlencoded({ extended: false, limit: '10kb', parameterLimit: 10 }))
  app.use(express.json())
  app.use(contentType)
}

/**
 * Registered AFTER the routes, which is the only position where either works:
 * a 404 handler mounted earlier would answer every request, and an error
 * handler mounted earlier would never be reached by the routes it exists for.
 */
export const setupErrorHandling = (app: Express): void => {
  app.use(notFoundHandler)
  app.use(errorHandler)
}
