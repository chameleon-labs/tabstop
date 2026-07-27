import type { Authenticate, AuthenticateParams } from '../../../domain/usecases/authenticate.js'
import { InvalidCredentialsError } from '../../errors/invalid-credentials-error.js'
import { toAccountView } from '../../helpers/account-view.js'
import { badRequest, okWithCookies, serverError, unauthorized } from '../../helpers/http/http-helper.js'
import { setSessionCookie } from '../../helpers/session-cookie.js'
import type { Controller } from '../../protocols/controller.js'
import type { HttpResponse } from '../../protocols/http.js'
import type { Validation } from '../../protocols/validation.js'

export class LoginController implements Controller {
  constructor (
    private readonly validation: Validation<AuthenticateParams>,
    private readonly authenticate: Authenticate,
    private readonly sessionCookieName: string
  ) {}

  async handle (request: unknown): Promise<HttpResponse> {
    try {
      const validated = this.validation.validate(request)
      if ('error' in validated) return badRequest(validated.error)

      const session = await this.authenticate.auth(validated.data)
      // One response for an unknown email and a wrong password alike.
      if (session === null) return unauthorized(new InvalidCredentialsError())

      return okWithCookies(toAccountView(session.account), setSessionCookie(this.sessionCookieName, session))
    } catch (error) {
      return serverError(error as Error)
    }
  }
}
