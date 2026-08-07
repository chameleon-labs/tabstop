import type {AccountModel} from '../../../domain/models/account.js';
import {toAccountView} from '../../helpers/account-view.js';
import {ok, serverError} from '../../helpers/http/http-helper.js';
import type {Controller} from '../../protocols/controller.js';
import type {HttpResponse} from '../../protocols/http.js';

export type MeRequest = {
  account: AccountModel;
};

/**
 * The auth middleware has already resolved the session, so this reads what the
 * middleware put in res.locals rather than loading the account a second time.
 */
export class MeController implements Controller<MeRequest> {
  constructor() {}

  async handle(request: MeRequest): Promise<HttpResponse> {
    try {
      return ok(toAccountView(request.account));
    } catch (error) {
      return serverError(error as Error);
    }
  }
}
