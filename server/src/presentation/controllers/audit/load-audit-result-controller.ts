import type {AuditStatus} from '../../../domain/models/audit.js';
import type {LoadAuditResult} from '../../../domain/usecases/load-audit-result.js';
import {AuditNotFoundError} from '../../errors/audit-not-found-error.js';
import {toAuditResultResponse} from '../../helpers/audit-view.js';
import {notFound, okCacheable, serverError} from '../../helpers/http/http-helper.js';
import type {Controller} from '../../protocols/controller.js';
import type {HttpResponse} from '../../protocols/http.js';

export type LoadAuditResultRequest = {
  uuid?: unknown;
};

const TERMINAL: ReadonlySet<AuditStatus> = new Set<AuditStatus>(['done', 'failed']);

/**
 * A finished audit is immutable and carries nothing user-identifying, so it is
 * safe for a shared cache to hold - which matters for the share page (#23),
 * where one link can bring real traffic. An in-flight one changes on the next
 * poll, so it must not be cached at all.
 */
const cacheControlFor = (status: AuditStatus): string => (TERMINAL.has(status) ? 'public, max-age=3600' : 'no-store');

export class LoadAuditResultController implements Controller<LoadAuditResultRequest> {
  constructor(private readonly loadAuditResult: LoadAuditResult) {}

  async handle(request: LoadAuditResultRequest): Promise<HttpResponse> {
    try {
      if (typeof request.uuid !== 'string') {
        return notFound(new AuditNotFoundError());
      }

      const result = await this.loadAuditResult.load(request.uuid);
      // Unknown and malformed are the same answer: a malformed uuid cannot
      // match a row, so it is a miss rather than an error.
      if (result === null) {
        return notFound(new AuditNotFoundError());
      }

      return okCacheable(toAuditResultResponse(result), cacheControlFor(result.audit.status));
    } catch (error) {
      return serverError(error as Error);
    }
  }
}
