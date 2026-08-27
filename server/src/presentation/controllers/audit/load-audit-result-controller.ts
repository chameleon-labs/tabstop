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

const cacheControlFor = (status: AuditStatus): string => (TERMINAL.has(status) ? 'public, max-age=3600' : 'no-store');

export class LoadAuditResultController implements Controller<LoadAuditResultRequest> {
  constructor(private readonly loadAuditResult: LoadAuditResult) {}

  async handle(request: LoadAuditResultRequest): Promise<HttpResponse> {
    try {
      if (typeof request.uuid !== 'string') {
        return notFound(new AuditNotFoundError());
      }

      const result = await this.loadAuditResult.load(request.uuid);
      if (result === null) {
        return notFound(new AuditNotFoundError());
      }

      return okCacheable(toAuditResultResponse(result), cacheControlFor(result.audit.status));
    } catch (error) {
      return serverError(error as Error);
    }
  }
}
