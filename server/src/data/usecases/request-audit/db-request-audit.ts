import {parseAuditUrl, type UrlPolicy} from '../../../domain/services/url-safety.js';
import {ENQUEUE_TIMEOUT_MS, enqueueAudit, resolvesSafely, withTimeout} from '../../helpers/audit-submission.js';
import type {DnsResolver} from '../../protocols/net/dns-resolver.js';
import type {RequestAudit, RequestAuditParams, RequestAuditResult} from '../../../domain/usecases/request-audit.js';
import type {AddAuditRepository} from '../../protocols/db/audit/add-audit-repository.js';
import type {DeleteQueuedAuditRepository} from '../../protocols/db/audit/delete-queued-audit-repository.js';
import type {AuditJobQueue} from '../../protocols/queue/audit-job-queue.js';

const DEFAULT_MAX_QUEUE_DEPTH = 100;

export class DbRequestAudit implements RequestAudit {
  constructor(
    private readonly addAuditRepository: AddAuditRepository,
    private readonly deleteQueuedAuditRepository: DeleteQueuedAuditRepository,
    private readonly auditQueue: AuditJobQueue,
    private readonly dnsResolver: DnsResolver,
    private readonly urlPolicy: UrlPolicy,
    private readonly maxQueueDepth: number = DEFAULT_MAX_QUEUE_DEPTH,
  ) {}

  async request({url}: RequestAuditParams): Promise<RequestAuditResult> {
    const parsed = parseAuditUrl(url, this.urlPolicy);
    if (!parsed.safe) {
      return {outcome: 'rejected', reason: parsed.reason};
    }

    if (!(await resolvesSafely(parsed.url, this.dnsResolver, this.urlPolicy))) {
      return {outcome: 'rejected', reason: 'blocked-address'};
    }

    if (await this.queueIsSaturated()) {
      return {outcome: 'unavailable'};
    }

    const audit = await this.addAuditRepository.add({
      url: parsed.url.toString(),
      pageId: null,
    });

    const enqueued = await enqueueAudit(this.auditQueue, audit.id);

    if (enqueued === 'failed') {
      await this.deleteQueuedAuditRepository.deleteIfQueued(audit.id).catch(() => undefined);
      return {outcome: 'unavailable'};
    }

    return {outcome: 'queued', audit};
  }

  private async queueIsSaturated(): Promise<boolean> {
    try {
      const backlog = await withTimeout(this.auditQueue.backlogCount(), ENQUEUE_TIMEOUT_MS);
      return backlog >= this.maxQueueDepth;
    } catch {
      return false;
    }
  }
}
