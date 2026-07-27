import { AuthMiddleware } from '../../../presentation/middlewares/auth-middleware.js'
import type { Middleware } from '../../../presentation/protocols/middleware.js'
import { makeLoadAccountBySession } from '../usecases/account/account-usecase-factories.js'

export const makeAuthMiddleware = (): Middleware =>
  new AuthMiddleware(makeLoadAccountBySession())
