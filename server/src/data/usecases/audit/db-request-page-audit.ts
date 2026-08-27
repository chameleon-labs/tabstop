import {ON_DEMAND_AUDITS_PER_DAY, nextAllowanceAt} from '../../../domain/services/on-demand-allowance.js';
import {utcDay} from '../../../domain/services/utc-day.js';
import {ENQUEUE_TIMEOUT_MS, enqueueAudit, withTimeout} from '../../helpers/audit-submission.js';
import type {
  RequestPageAudit,
  RequestPageAuditParams,
  RequestPageAuditResult,
} from '../../../domain/usecases/request-page-audit.js';
import type {
  AddOnDemandAuditRepository,
  ReleaseOnDemandAuditRepository,
} from '../../protocols/db/audit/add-on-demand-audit-repository.js';
import type {AuditJobQueue} from '../../protocols/queue/audit-job-queue.js';

const DEFAULT_MAX_QUEUE_DEPTH = 100;

export class DbRequestPageAudit implements RequestPageAudit {
  constructor(
    private readonly addOnDemandAuditRepository: AddOnDemandAuditRepository,
    private readonly releaseOnDemandAuditRepository: ReleaseOnDemandAuditRepository,
    private readonly auditQueue: AuditJobQueue,
    private readonly maxQueueDepth: number = DEFAULT_MAX_QUEUE_DEPTH,
    private readonly allowance: number = ON_DEMAND_AUDITS_PER_DAY,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  async request({userId, pageId}: RequestPageAuditParams): Promise<RequestPageAuditResult> {
    const now = this.now();

    if (await this.queueIsSaturated()) {
      return {outcome: 'unavailable'};
    }

    const result = await this.addOnDemandAuditRepository.addOnDemand({
      userId,
      pageId,
      day: utcDay(now),
      allowance: this.allowance,
    });

    if (result.outcome === 'not-found') {
      return {outcome: 'not-found'};
    }
    if (result.outcome === 'in-flight') {
      return {outcome: 'in-flight'};
    }
    if (result.outcome === 'allowance-spent') {
      return {outcome: 'allowance-spent', resetAt: nextAllowanceAt(now)};
    }

    const enqueued = await enqueueAudit(this.auditQueue, result.audit.id);

    if (enqueued === 'failed') {
      await this.releaseOnDemandAuditRepository.releaseOnDemand(result.audit.id).catch(() => undefined);
      return {outcome: 'unavailable'};
    }

    return {outcome: 'queued', audit: result.audit};
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
