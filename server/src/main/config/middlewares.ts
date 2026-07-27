import express, { type Express } from 'express'
import { cors, contentType, noStore } from '../middlewares/index.js'

export const setupMiddlewares = (app: Express): void => {
  app.use(cors)
  app.use(noStore)
  app.use(express.json())
  app.use(contentType)
}
