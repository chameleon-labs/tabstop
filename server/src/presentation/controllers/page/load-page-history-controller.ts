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

      if (history === null) {
        return notFound(new PageNotFoundError());
      }

      return okCacheable(toPageHistoryView(history, validated.data.days), CACHE_CONTROL, 'Cookie');
    } catch (error) {
      return serverError(error as Error);
    }
  }
}
