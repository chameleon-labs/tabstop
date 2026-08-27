import type {RequestPageAudit} from '../../../domain/usecases/request-page-audit.js';
import {PageNotFoundError} from '../../errors/page-not-found-error.js';
import {toRequestAuditResponse} from '../../helpers/audit-view.js';
import {accepted, codedConflict, notFound, serverError, serviceUnavailable} from '../../helpers/http/http-helper.js';
import {PAGE_AUDIT_CONFLICT, allowanceResetDetails} from '../../helpers/page-audit-conflict-view.js';
import type {Controller} from '../../protocols/controller.js';
import type {HttpResponse} from '../../protocols/http.js';

export type RequestPageAuditRequest = {
  id?: unknown;
  userId: string;
};

const POLL_AFTER_MS = 2000;

export class RequestPageAuditController implements Controller<RequestPageAuditRequest> {
  constructor(private readonly requestPageAudit: RequestPageAudit) {}

  async handle(request: RequestPageAuditRequest): Promise<HttpResponse> {
    try {
      if (typeof request.id !== 'string') {
        return notFound(new PageNotFoundError());
      }

      const result = await this.requestPageAudit.request({
        userId: request.userId,
        pageId: request.id,
      });

      if (result.outcome === 'not-found') {
        return notFound(new PageNotFoundError());
      }

      if (result.outcome === 'in-flight') {
        return codedConflict(PAGE_AUDIT_CONFLICT.inFlight, new Error('This page is already being audited'));
      }

      if (result.outcome === 'allowance-spent') {
        return codedConflict(
          PAGE_AUDIT_CONFLICT.allowanceSpent,
          new Error('You have used your audit for today'),
          allowanceResetDetails(result.resetAt),
        );
      }

      if (result.outcome === 'unavailable') {
        return serviceUnavailable({error: 'Could not queue that audit, please try again'});
      }

      return accepted(toRequestAuditResponse(result.audit, POLL_AFTER_MS));
    } catch (error) {
      return serverError(error as Error);
    }
  }
}
