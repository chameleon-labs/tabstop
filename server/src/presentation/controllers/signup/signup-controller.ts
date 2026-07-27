import type { AddAccountParams } from '../../../domain/usecases/add-account.js'
import type { AddAccount } from '../../../domain/usecases/add-account.js'
import { EmailInUseError } from '../../errors/email-in-use-error.js'
import { toAccountView } from '../../helpers/account-view.js'
import { badRequest, conflict, created, serverError } from '../../helpers/http/http-helper.js'
import { setSessionCookie } from '../../helpers/session-cookie.js'
import type { Controller } from '../../protocols/controller.js'
import type { HttpResponse } from '../../protocols/http.js'
import type { Validation } from '../../protocols/validation.js'

export class SignupController implements Controller {
  constructor (
    private readonly validation: Validation<AddAccountParams>,
    private readonly addAccount: AddAccount
  ) {}

  async handle (request: unknown): Promise<HttpResponse> {
    try {
      const validated = this.validation.validate(request)
      if ('error' in validated) return badRequest(validated.error)

      const session = await this.addAccount.add(validated.data)
      // Null means the email is taken - including when a concurrent signup won
      // the race, which the repository turns into the same outcome.
      if (session === null) return conflict(new EmailInUseError())

      return created(toAccountView(session.account), setSessionCookie(session))
    } catch (error) {
      return serverError(error as Error)
    }
  }
}
