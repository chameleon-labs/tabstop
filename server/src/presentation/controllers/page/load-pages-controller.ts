import type {LoadPages} from '../../../domain/usecases/load-pages.js';
import {ok, serverError} from '../../helpers/http/http-helper.js';
import {toPageSummaryView} from '../../helpers/page-view.js';
import type {Controller} from '../../protocols/controller.js';
import type {HttpResponse} from '../../protocols/http.js';

export type LoadPagesRequest = {
  userId: string;
};

export class LoadPagesController implements Controller<LoadPagesRequest> {
  constructor(private readonly loadPages: LoadPages) {}

  async handle(request: LoadPagesRequest): Promise<HttpResponse> {
    try {
      const result = await this.loadPages.load(request.userId);

      return ok({
        pages: result.pages.map(toPageSummaryView),
        limit: result.limit,
        used: result.pages.length,
      });
    } catch (error) {
      return serverError(error as Error);
    }
  }
}
