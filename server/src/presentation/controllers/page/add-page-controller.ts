import type { AddPage } from '../../../domain/usecases/add-page.js'
import { PageAlreadyTrackedError } from '../../errors/page-already-tracked-error.js'
import { PageLimitReachedError } from '../../errors/page-limit-reached-error.js'
import { badRequest, codedConflict, created, serverError } from '../../helpers/http/http-helper.js'
import { toPageView } from '../../helpers/page-view.js'
import { REJECTION_MESSAGES } from '../../helpers/url-rejection-message.js'
import type { Controller } from '../../protocols/controller.js'
import type { HttpResponse } from '../../protocols/http.js'
import type { Validation } from '../../protocols/validation.js'

export type AddPageRequest = {
  /**
   * Written by the auth middleware into res.locals, which adaptRoute merges
   * LAST - after body, query and params - so a client cannot post its own.
   */
  userId: string
}

export type AddPageBody = {
  url: string
}

export class AddPageController implements Controller<AddPageRequest> {
  constructor (
    private readonly validation: Validation<AddPageBody>,
    private readonly addPage: AddPage
  ) {}

  async handle (request: AddPageRequest): Promise<HttpResponse> {
    try {
      const validated = this.validation.validate(request)
      if ('error' in validated) return badRequest(validated.error)

      const result = await this.addPage.add({
        userId: request.userId,
        url: validated.data.url
      })

      if (result.outcome === 'rejected') {
        return badRequest(new Error(REJECTION_MESSAGES[result.reason]))
      }

      // Both are 409s a client has to tell apart to render the right thing, so
      // each carries a code rather than only a sentence.
      if (result.outcome === 'limit-reached') {
        return codedConflict(
          'page_limit_reached', new PageLimitReachedError(result.limit), { limit: result.limit }
        )
      }

      if (result.outcome === 'duplicate') {
        return codedConflict('page_already_tracked', new PageAlreadyTrackedError())
      }

      return created({
        ...toPageView(result.page),
        // Null when the queue would not take the job. The page is tracked
        // either way; this is what the client polls, so it must not name an
        // audit that will never run.
        firstAuditId: result.firstAuditId
      })
    } catch (error) {
      return serverError(error as Error)
    }
  }
}
