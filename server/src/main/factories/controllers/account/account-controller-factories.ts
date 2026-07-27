import { LoginController } from '../../../../presentation/controllers/login/login-controller.js'
import { LogoutController } from '../../../../presentation/controllers/logout/logout-controller.js'
import { MeController } from '../../../../presentation/controllers/me/me-controller.js'
import { SignupController } from '../../../../presentation/controllers/signup/signup-controller.js'
import type { Controller } from '../../../../presentation/protocols/controller.js'
import {
  makeAddAccount, makeAuthenticate, makeRevokeSession
} from '../../usecases/account/account-usecase-factories.js'
import { makeLoginValidation, makeSignupValidation } from '../../validation/account-validation-factory.js'

export const makeSignupController = (): Controller =>
  new SignupController(makeSignupValidation(), makeAddAccount())

export const makeLoginController = (): Controller =>
  new LoginController(makeLoginValidation(), makeAuthenticate())

export const makeLogoutController = (): Controller =>
  new LogoutController(makeRevokeSession()) as Controller

export const makeMeController = (): Controller =>
  new MeController() as Controller
