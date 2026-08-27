import type {AddAccountParams, AddAccount} from '../../../domain/usecases/add-account.js';
import {EmailInUseError} from '../../errors/email-in-use-error.js';
import {toAccountView} from '../../helpers/account-view.js';
import {badRequest, conflict, created, serverError} from '../../helpers/http/http-helper.js';
import {setSessionCookie} from '../../helpers/session-cookie.js';
import type {Controller} from '../../protocols/controller.js';
import type {HttpResponse} from '../../protocols/http.js';
import type {Validation} from '../../protocols/validation.js';

export class SignupController implements Controller {
  constructor(
    private readonly validation: Validation<AddAccountParams>,
    private readonly addAccount: AddAccount,
    private readonly sessionCookieName: string,
  ) {}

  async handle(request: unknown): Promise<HttpResponse> {
    try {
      const validated = this.validation.validate(request);
      if ('error' in validated) {
        return badRequest(validated.error);
      }

      const session = await this.addAccount.add(validated.data);
      if (session === null) {
        return conflict(new EmailInUseError());
      }

      return created(toAccountView(session.account), setSessionCookie(this.sessionCookieName, session));
    } catch (error) {
      return serverError(error as Error);
    }
  }
}
