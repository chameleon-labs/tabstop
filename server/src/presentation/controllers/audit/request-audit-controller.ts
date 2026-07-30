import type { RequestAudit } from '../../../domain/usecases/request-audit.js'
import {
  accepted, badRequest, serverError, serviceUnavailable
} from '../../helpers/http/http-helper.js'
import { REJECTION_MESSAGES } from '../../helpers/url-rejection-message.js'
import type { Controller } from '../../protocols/controller.js'
import type { HttpResponse } from '../../protocols/http.js'

export type RequestAuditRequest = {
  url?: unknown
}

/** How long a client should wait before polling. Widening it needs no frontend deploy. */
const POLL_AFTER_MS = 2000

export class RequestAuditController implements Controller<RequestAuditRequest> {
  constructor (private readonly requestAudit: RequestAudit) {}

  async handle (request: RequestAuditRequest): Promise<HttpResponse> {
    try {
      if (typeof request.url !== 'string' || request.url === '') {
        return badRequest(new Error('A url is required'))
      }

      const result = await this.requestAudit.request({ url: request.url })

      if (result.outcome === 'rejected') {
        return badRequest(new Error(REJECTION_MESSAGES[result.reason]))
      }

      if (result.outcome === 'unavailable') {
        // The row has been removed, so this is a clean "try again" rather than
        // a half-created audit the client would have to reason about.
        return serviceUnavailable({ error: 'Could not queue that audit, please try again' })
      }

      return accepted({
        // The public uuid only. The internal id is never exposed.
        auditId: result.audit.publicUuid,
        status: result.audit.status,
        pollAfterMs: POLL_AFTER_MS
      })
    } catch (error) {
      return serverError(error as Error)
    }
  }
}
