import type {LoadPageHistory} from '../../../domain/usecases/load-page-history.js';
import {PageNotFoundError} from '../../errors/page-not-found-error.js';
import {badRequest, notFound, okCacheable, serverError} from '../../helpers/http/http-helper.js';
import {toPageHistoryView} from '../../helpers/page-view.js';
import type {Controller} from '../../protocols/controller.js';
import type {HttpResponse} from '../../protocols/http.js';
import type {Validation} from '../../protocols/validation.js';

export type LoadPageHistoryRequest = {
  id?: unknown;
  userId: string;
};

export type LoadPageHistoryQuery = {
  days: number;
};

/**
 * Cacheable, and `private` rather than `public`.
 *
 * A finished audit is immutable and a monitored page gains at most one point a
 * day, so a minute of staleness is invisible while the repeat-visit cost goes
 * to zero. But unlike the share page (#23), this is owner-scoped data behind a
 * session - `public` would let a shared cache hand one account's history to
 * the next request that happened to match the URL.
 *
 * `Vary: Cookie` on top, because the URL alone does not identify the response:
 * two accounts on one browser share `/api/pages/1/history` and must not share
 * its cache entry.
 */
const CACHE_CONTROL = 'private, max-age=60';

export class LoadPageHistoryController implements Controller<LoadPageHistoryRequest> {
  constructor(
    private readonly validation: Validation<LoadPageHistoryQuery>,
    private readonly loadPageHistory: LoadPageHistory,
  ) {}

  async handle(request: LoadPageHistoryRequest): Promise<HttpResponse> {
    try {
      const validated = this.validation.validate(request);
      if ('error' in validated) {
        return badRequest(validated.error);
      }

      if (typeof request.id !== 'string') {
        return notFound(new PageNotFoundError());
      }

      const history = await this.loadPageHistory.load({
        pageId: request.id,
        userId: request.userId,
        days: validated.data.days,
      });

      // Same conflation as every other page route: somebody else's page and a
      // page that never existed are one answer.
      if (history === null) {
        return notFound(new PageNotFoundError());
      }

      return okCacheable(toPageHistoryView(history, validated.data.days), CACHE_CONTROL, 'Cookie');
    } catch (error) {
      return serverError(error as Error);
    }
  }
}
