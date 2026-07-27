import express, { type Express } from 'express'
import { cors, contentType, noStore, sameOrigin } from '../middlewares/index.js'

export const setupMiddlewares = (app: Express): void => {
  app.use(cors)
  app.use(noStore)
  app.use(sameOrigin)
  app.use(express.json())
  app.use(contentType)
}
