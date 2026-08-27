import {reauditDelayMs, utcDay, utcDayStart} from '../../../domain/services/reaudit-schedule.js';
import type {
  ReauditRunSummary,
  RunScheduledReaudits,
  RunScheduledReauditsOptions,
} from '../../../domain/usecases/run-scheduled-reaudits.js';
import {ENQUEUE_TIMEOUT_MS, enqueueAudit, withTimeout} from '../../helpers/audit-submission.js';
import type {AddScheduledAuditRepository} from '../../protocols/db/audit/add-scheduled-audit-repository.js';
import type {DeleteQueuedAuditRepository} from '../../protocols/db/audit/delete-queued-audit-repository.js';
import type {
  ReclaimAbandonedAuditsRepository,
  StaleAudit,
} from '../../protocols/db/audit/reclaim-abandoned-audits-repository.js';
import type {DuePage, LoadDueReauditsRepository} from '../../protocols/db/page/load-due-reaudits-repository.js';
import type {AuditJobQueue} from '../../protocols/queue/audit-job-queue.js';

export const ABANDONED_ERROR = 'Abandoned: no job remained to finish this audit';

export class DbRunScheduledReaudits implements RunScheduledReaudits {
  constructor(
    private readonly duePages: LoadDueReauditsRepository,
    private readonly audits: AddScheduledAuditRepository & ReclaimAbandonedAuditsRepository,
    private readonly deleteQueuedAuditRepository: DeleteQueuedAuditRepository,
    private readonly auditQueue: AuditJobQueue,
    private readonly batchSize: number,
    private readonly maxPagesPerRun: number,
    private readonly staleAfterMs: number,
  ) {}

  async run(now: Date, options: RunScheduledReauditsOptions = {}): Promise<ReauditRunSummary> {
    const {signal, report} = options;

    const scheduledFor = utcDay(now);
    const dayStart = utcDayStart(now);

    const summary = {
      scheduledFor,
      pagesConsidered: 0,
      auditsEnqueued: 0,
      skippedDuplicate: 0,
      failed: 0,
      abandonedReclaimed: 0,
      reclaimFailures: 0,
      truncated: false,
    };

    const stopped = (): boolean => signal?.aborted ?? false;
    const publish = (): void => {
      report?.({...summary});
    };

    const reclaim = await this.reclaimAbandoned(now, stopped);
    summary.abandonedReclaimed = reclaim.reclaimed;
    summary.reclaimFailures = reclaim.failed;
    publish();

    let after: string | null = null;

    for (;;) {
      if (stopped()) {
        summary.truncated = true;
        break;
      }

      const remaining = this.maxPagesPerRun - summary.pagesConsidered;
      if (remaining <= 0) {
        summary.truncated = true;
        break;
      }

      const wanted = Math.min(this.batchSize, remaining);
      const rows = await this.duePages.loadDueForReaudit({
        dayStart,
        limit: wanted + 1,
        after,
      });

      const batch = rows.slice(0, wanted);
      if (batch.length === 0) {
        break;
      }

      for (const page of batch) {
        if (stopped()) {
          summary.truncated = true;
          return summary;
        }

        const outcome = await this.schedule(page, scheduledFor);
        summary[outcome] += 1;
        summary.pagesConsidered += 1;
      }

      after = batch[batch.length - 1]?.pageId ?? null;
      publish();
      if (rows.length <= wanted) {
        break;
      }
    }

    return summary;
  }

  private async reclaimAbandoned(now: Date, stopped: () => boolean): Promise<{reclaimed: number; failed: number}> {
    const staleBefore = new Date(now.getTime() - this.staleAfterMs);

    let reclaimed = 0;
    let failed = 0;
    let examined = 0;
    let after: StaleAudit | null = null;

    while (examined < this.maxPagesPerRun) {
      if (stopped()) {
        break;
      }

      const wanted = Math.min(this.batchSize, this.maxPagesPerRun - examined);

      let candidates: StaleAudit[];
      try {
        candidates = await this.audits.loadStaleInFlight(staleBefore, wanted, after);
      } catch {
        return {reclaimed, failed: failed + 1};
      }

      if (candidates.length === 0) {
        break;
      }

      for (const candidate of candidates) {
        if (stopped()) {
          return {reclaimed, failed};
        }
        examined += 1;

        const verdict = await this.queueVerdict(candidate.auditId);
        if (verdict === 'pending') {
          continue;
        }
        if (verdict === 'unknown') {
          failed += 1;
          continue;
        }

        try {
          if (await this.audits.markAbandoned(candidate.auditId, ABANDONED_ERROR)) {
            reclaimed += 1;
          }
        } catch {
          failed += 1;
        }
      }

      after = candidates[candidates.length - 1] ?? null;
      if (candidates.length < wanted) {
        break;
      }
    }

    return {reclaimed, failed};
  }

  private async queueVerdict(auditId: string): Promise<'pending' | 'gone' | 'unknown'> {
    try {
      const pending = await withTimeout(this.auditQueue.isPending(auditId), ENQUEUE_TIMEOUT_MS);
      return pending ? 'pending' : 'gone';
    } catch {
      return 'unknown';
    }
  }

  private async schedule(
    page: DuePage,
    scheduledFor: string,
  ): Promise<'auditsEnqueued' | 'skippedDuplicate' | 'failed'> {
    let auditId: string;
    try {
      const audit = await this.audits.addScheduled({
        pageId: page.pageId,
        url: page.url,
        scheduledFor,
      });
      if (audit === null) {
        return 'skippedDuplicate';
      }
      auditId = audit.id;
    } catch {
      return 'failed';
    }

    const enqueued = await enqueueAudit(this.auditQueue, auditId, reauditDelayMs(page.domain, page.pageId));

    if (enqueued === 'failed') {
      await this.deleteQueuedAuditRepository.deleteIfQueued(auditId).catch(() => undefined);
      return 'failed';
    }

    return 'auditsEnqueued';
  }
}
