import type {UpdatePage} from '../../../domain/usecases/update-page.js';
import {PageNotFoundError} from '../../errors/page-not-found-error.js';
import {badRequest, notFound, ok, serverError} from '../../helpers/http/http-helper.js';
import {toPageView} from '../../helpers/page-view.js';
import type {Controller} from '../../protocols/controller.js';
import type {HttpResponse} from '../../protocols/http.js';
import type {Validation} from '../../protocols/validation.js';

export type UpdatePageRequest = {
  id?: unknown;
  userId: string;
};

export type UpdatePageBody = {
  monitoringEnabled: boolean;
};

export class UpdatePageController implements Controller<UpdatePageRequest> {
  constructor(
    private readonly validation: Validation<UpdatePageBody>,
    private readonly updatePage: UpdatePage,
  ) {}

  async handle(request: UpdatePageRequest): Promise<HttpResponse> {
    try {
      const validated = this.validation.validate(request);
      if ('error' in validated) {
        return badRequest(validated.error);
      }

      if (typeof request.id !== 'string') {
        return notFound(new PageNotFoundError());
      }

      const page = await this.updatePage.update({
        pageId: request.id,
        userId: request.userId,
        monitoringEnabled: validated.data.monitoringEnabled,
      });

      if (page === null) {
        return notFound(new PageNotFoundError());
      }

      return ok(toPageView(page));
    } catch (error) {
      return serverError(error as Error);
    }
  }
}
