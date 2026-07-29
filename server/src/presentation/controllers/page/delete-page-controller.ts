import type { DeletePage } from '../../../domain/usecases/delete-page.js'
import { PageNotFoundError } from '../../errors/page-not-found-error.js'
import { noContent, notFound, serverError } from '../../helpers/http/http-helper.js'
import type { Controller } from '../../protocols/controller.js'
import type { HttpResponse } from '../../protocols/http.js'

export type DeletePageRequest = {
  id?: unknown
  userId: string
}

/**
 * Not idempotent in the way logout is: a second delete answers 404 rather than
 * 204. Deleting a page destroys its whole audit history, so "that is already
 * gone" is information the client needs, not noise to swallow.
 */
export class DeletePageController implements Controller<DeletePageRequest> {
  constructor (private readonly deletePage: DeletePage) {}

  async handle (request: DeletePageRequest): Promise<HttpResponse> {
    try {
      if (typeof request.id !== 'string') return notFound(new PageNotFoundError())

      const deleted = await this.deletePage.delete({
        pageId: request.id,
        userId: request.userId
      })

      // Same answer for somebody else's page as for one that never existed.
      if (!deleted) return notFound(new PageNotFoundError())

      return noContent()
    } catch (error) {
      return serverError(error as Error)
    }
  }
}
