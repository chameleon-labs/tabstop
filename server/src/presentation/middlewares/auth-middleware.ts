import type {LoadAccountBySession} from '../../domain/usecases/load-account-by-session.js';
import {UnauthorizedError} from '../errors/unauthorized-error.js';
import {ok, serverError, unauthorized} from '../helpers/http/http-helper.js';
import type {HttpResponse} from '../protocols/http.js';
import type {Middleware, MiddlewareRequest} from '../protocols/middleware.js';

export class AuthMiddleware implements Middleware {
  constructor(
    private readonly loadAccountBySession: LoadAccountBySession,
    private readonly sessionCookieName: string,
  ) {}

  async handle(request: MiddlewareRequest): Promise<HttpResponse> {
    try {
      const sessionId = request.cookies[this.sessionCookieName];
      if (sessionId === undefined || sessionId === '') {
        return unauthorized(new UnauthorizedError());
      }

      const account = await this.loadAccountBySession.load(sessionId);
      if (account === null) {
        return unauthorized(new UnauthorizedError());
      }

      // userId is what #11's ownership-scoped repositories need; account saves
      // /api/me a second lookup. Both land in res.locals, which adaptRoute
      // merges last so neither can be spoofed from the request body.
      return ok({userId: account.id, account});
    } catch (error) {
      return serverError(error as Error);
    }
  }
}
