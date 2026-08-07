import type {LoadPages} from '../../../domain/usecases/load-pages.js';
import {ok, serverError} from '../../helpers/http/http-helper.js';
import {toPageSummaryView} from '../../helpers/page-view.js';
import type {Controller} from '../../protocols/controller.js';
import type {HttpResponse} from '../../protocols/http.js';

export type LoadPagesRequest = {
  userId: string;
};

/**
 * The dashboard's only call, so it answers everything that screen needs - the
 * rows, the sparkline points, and the cap - in one request.
 */
export class LoadPagesController implements Controller<LoadPagesRequest> {
  constructor(private readonly loadPages: LoadPages) {}

  async handle(request: LoadPagesRequest): Promise<HttpResponse> {
    try {
      const result = await this.loadPages.load(request.userId);

      return ok({
        pages: result.pages.map(toPageSummaryView),
        limit: result.limit,
        // Sent rather than left to the client to count, so "7 of 10" cannot
        // disagree with what the server will actually accept.
        used: result.pages.length,
      });
    } catch (error) {
      return serverError(error as Error);
    }
  }
}
