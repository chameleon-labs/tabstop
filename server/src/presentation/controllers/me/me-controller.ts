import type {AccountModel} from '../../../domain/models/account.js';
import {toAccountView} from '../../helpers/account-view.js';
import {ok, serverError} from '../../helpers/http/http-helper.js';
import type {Controller} from '../../protocols/controller.js';
import type {HttpResponse} from '../../protocols/http.js';

export type MeRequest = {
  account: AccountModel;
};

export class MeController implements Controller<MeRequest> {
  handle(request: MeRequest): Promise<HttpResponse> {
    try {
      return Promise.resolve(ok(toAccountView(request.account)));
    } catch (error) {
      return Promise.resolve(serverError(error as Error));
    }
  }
}
