import { LoginController } from '../../../../presentation/controllers/login/login-controller.js'
import {
  LogoutController, type LogoutRequest
} from '../../../../presentation/controllers/logout/logout-controller.js'
import {
  MeController, type MeRequest
} from '../../../../presentation/controllers/me/me-controller.js'
import { SignupController } from '../../../../presentation/controllers/signup/signup-controller.js'
import type { Controller } from '../../../../presentation/protocols/controller.js'
import {
  makeAddAccount, makeAuthenticate, makeRevokeSession
} from '../../usecases/account/account-usecase-factories.js'
import { makeLoginValidation, makeSignupValidation } from '../../validation/account-validation-factory.js'
import { SESSION_COOKIE_NAME } from '../../../config/session-cookie.js'

export const makeSignupController = (): Controller =>
  new SignupController(makeSignupValidation(), makeAddAccount(), SESSION_COOKIE_NAME)

export const makeLoginController = (): Controller =>
  new LoginController(makeLoginValidation(), makeAuthenticate(), SESSION_COOKIE_NAME)

export const makeLogoutController = (): Controller<LogoutRequest> =>
  new LogoutController(makeRevokeSession(), SESSION_COOKIE_NAME)

export const makeMeController = (): Controller<MeRequest> =>
  new MeController()
