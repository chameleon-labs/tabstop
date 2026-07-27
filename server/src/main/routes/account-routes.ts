import type { Router } from 'express'
import { adaptMiddleware } from '../adapters/express-middleware-adapter.js'
import { adaptRoute } from '../adapters/express-route-adapter.js'
import {
  makeLoginController, makeLogoutController, makeMeController, makeSignupController
} from '../factories/controllers/account/account-controller-factories.js'
import { makeAuthMiddleware } from '../factories/middlewares/auth-middleware-factory.js'

export default (router: Router): void => {
  router.post('/signup', adaptRoute(makeSignupController()))
  router.post('/login', adaptRoute(makeLoginController()))
  // Not behind the auth middleware: logout stays idempotent rather than 401.
  router.post('/logout', adaptRoute(makeLogoutController()))
  router.get('/me', adaptMiddleware(makeAuthMiddleware()), adaptRoute(makeMeController()))
}
