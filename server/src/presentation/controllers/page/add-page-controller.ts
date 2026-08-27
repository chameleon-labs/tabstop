import type {AddPage} from '../../../domain/usecases/add-page.js';
import {PageAlreadyTrackedError} from '../../errors/page-already-tracked-error.js';
import {PageLimitReachedError} from '../../errors/page-limit-reached-error.js';
import {badRequest, codedConflict, created, serverError} from '../../helpers/http/http-helper.js';
import {PAGE_CONFLICT, pageLimitDetails} from '../../helpers/page-conflict-view.js';
import {toPageView} from '../../helpers/page-view.js';
import {REJECTION_MESSAGES} from '../../helpers/url-rejection-message.js';
import type {Controller} from '../../protocols/controller.js';
import type {HttpResponse} from '../../protocols/http.js';
import type {Validation} from '../../protocols/validation.js';

export type AddPageRequest = {
  url?: unknown;
  userId: string;
};

export type AddPageBody = {
  url: string;
};

export class AddPageController implements Controller<AddPageRequest> {
  constructor(
    private readonly validation: Validation<AddPageBody>,
    private readonly addPage: AddPage,
  ) {}

  async handle(request: AddPageRequest): Promise<HttpResponse> {
    try {
      const validated = this.validation.validate(request);
      if ('error' in validated) {
        return badRequest(validated.error);
      }

      const result = await this.addPage.add({
        userId: request.userId,
        url: validated.data.url,
      });

      if (result.outcome === 'rejected') {
        return badRequest(new Error(REJECTION_MESSAGES[result.reason]));
      }

      if (result.outcome === 'limit-reached') {
        return codedConflict(
          PAGE_CONFLICT.limitReached,
          new PageLimitReachedError(result.limit),
          pageLimitDetails(result.limit),
        );
      }

      if (result.outcome === 'duplicate') {
        return codedConflict(PAGE_CONFLICT.alreadyTracked, new PageAlreadyTrackedError());
      }

      return created({
        ...toPageView(result.page),
        firstAuditId: result.firstAuditId,
      });
    } catch (error) {
      return serverError(error as Error);
    }
  }
}
