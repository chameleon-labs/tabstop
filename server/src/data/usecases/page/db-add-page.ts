import {bareHostname, canonicalPageUrl, parseAuditUrl, type UrlPolicy} from '../../../domain/services/url-safety.js';
import type {AddPage, AddPageParams, AddPageResult} from '../../../domain/usecases/add-page.js';
import {enqueueAudit, resolvesSafely} from '../../helpers/audit-submission.js';
import type {AddPageRepository} from '../../protocols/db/page/add-page-repository.js';
import type {DeleteQueuedAuditRepository} from '../../protocols/db/audit/delete-queued-audit-repository.js';
import type {DnsResolver} from '../../protocols/net/dns-resolver.js';
import type {AuditJobQueue} from '../../protocols/queue/audit-job-queue.js';

export class DbAddPage implements AddPage {
  constructor(
    private readonly addPageRepository: AddPageRepository,
    private readonly deleteQueuedAuditRepository: DeleteQueuedAuditRepository,
    private readonly auditQueue: AuditJobQueue,
    private readonly dnsResolver: DnsResolver,
    private readonly urlPolicy: UrlPolicy,
    private readonly limit: number,
  ) {}

  async add({userId, url}: AddPageParams): Promise<AddPageResult> {
    const parsed = parseAuditUrl(url, this.urlPolicy);
    if (!parsed.safe) {
      return {outcome: 'rejected', reason: parsed.reason};
    }

    if (!(await resolvesSafely(parsed.url, this.dnsResolver, this.urlPolicy))) {
      return {outcome: 'rejected', reason: 'blocked-address'};
    }

    const result = await this.addPageRepository.add({
      userId,
      domain: bareHostname(parsed.url),
      url: canonicalPageUrl(parsed.url),
      limit: this.limit,
    });

    if (result.outcome === 'limit-reached') {
      return {outcome: 'limit-reached', limit: this.limit};
    }
    if (result.outcome === 'duplicate') {
      return {outcome: 'duplicate'};
    }

    const enqueued = await enqueueAudit(this.auditQueue, result.firstAudit.id);

    if (enqueued === 'failed') {
      await this.deleteQueuedAuditRepository.deleteIfQueued(result.firstAudit.id).catch(() => undefined);
      return {outcome: 'added', page: result.page, firstAuditId: null};
    }

    return {
      outcome: 'added',
      page: result.page,
      firstAuditId: result.firstAudit.publicUuid,
    };
  }
}
