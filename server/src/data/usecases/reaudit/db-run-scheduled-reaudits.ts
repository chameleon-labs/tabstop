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

/**
 * The nightly fan-out: one audit per monitored page, spread over a window.
 *
 * A fan-out job rather than a worker - it runs no audit itself, it creates the
 * work the audit worker consumes. That separation is what lets the run finish
 * in a second while the work it scheduled takes six hours.
 *
 * IDEMPOTENT IN TWO LAYERS, because one is not enough. The eligibility query
 * excludes pages with work in flight, which is cheap and catches every
 * ordinary case - but it is check-then-act, so two overlapping runs both
 * select a page before either inserts. `addScheduled` returning null is the
 * second layer, and the one that actually makes "exactly one per page per day"
 * true. The gap is left open rather than locked, so the constraint stays
 * load-bearing rather than decorative.
 */
/**
 * What the reclaim pass writes on a row whose job no longer exists.
 *
 * Silent about how far the audit got: `queued` was never picked up and
 * `running` was started by a worker that died, and the only fact this pass
 * established is that nothing is left to finish it.
 */
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

    // Computed once, so every row of this run carries the same day. Derived
    // per row instead, a fan-out crossing midnight would stamp two dates and
    // both halves would pass the constraint.
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

    // Read through a call rather than inline, because `aborted` flips while
    // this loop runs and the compiler narrows it on first use otherwise -
    // deciding, reasonably but wrongly here, that a second check can never be
    // true.
    const stopped = (): boolean => signal?.aborted ?? false;
    // A copy each time. The caller keeps the last one to report a run that
    // never returned, and handing it the live object would leave it holding a
    // reference that kept changing under it.
    const publish = (): void => {
      report?.({...summary});
    };

    // Before the worklist, so a page freed by the reclaim pass is scheduled
    // tonight rather than tomorrow.
    const reclaim = await this.reclaimAbandoned(now, stopped);
    summary.abandonedReclaimed = reclaim.reclaimed;
    summary.reclaimFailures = reclaim.failed;
    publish();

    let after: string | null = null;

    // Paged rather than fetched whole. The batch bounds memory; the loop is
    // what keeps the promise, because a single capped query silently drops
    // every page past the cap - and since the cut is by page id, it drops the
    // SAME pages every night. Those accounts would stop being monitored with
    // nothing failing anywhere.
    for (;;) {
      // Checked between batches AND between pages. A full fan-out is far
      // longer than the shutdown grace, so without this a SIGTERM mid-run is
      // a force-exit - which can land between creating an audit row and
      // queueing its job, leaving exactly the stranded row the reaper above
      // then has to clean up.
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
      // One more row than the batch, so "is there another page" is answered by
      // the query. Inferring it from a full batch cannot tell a run that was
      // cut short from one that ended on exactly the batch size.
      const rows = await this.duePages.loadDueForReaudit({
        dayStart,
        limit: wanted + 1,
        after,
      });

      const batch = rows.slice(0, wanted);
      if (batch.length === 0) break;

      for (const page of batch) {
        if (stopped()) {
          summary.truncated = true;
          return summary;
        }

        const outcome = await this.schedule(page, scheduledFor);
        summary[outcome] += 1;
        summary.pagesConsidered += 1;
      }

      // Keyset, not an offset: every page just scheduled has an audit in
      // flight and has dropped out of the predicate, so an offset would skip
      // exactly as many pages as this batch handled.
      after = batch[batch.length - 1]?.pageId ?? null;
      publish();
      if (rows.length <= wanted) break;
    }

    return summary;
  }

  /**
   * Retires unfinished audits that no job is ever going to run.
   *
   * An unfinished audit hides its page from every future worklist, so a row
   * left by a lost enqueue ends that page's monitoring silently and forever.
   *
   * Ageing rows out of the eligibility query instead is wrong in a way worth
   * recording: on a queue that has not drained, real pending audits look
   * abandoned too, and each night piles more work onto the backlog. Age is a
   * filter and the queue is the verdict, so the interval is free to be
   * generous - it decides how much this scans, not what it concludes.
   */
  private async reclaimAbandoned(now: Date, stopped: () => boolean): Promise<{reclaimed: number; failed: number}> {
    const staleBefore = new Date(now.getTime() - this.staleAfterMs);

    let reclaimed = 0;
    let failed = 0;
    let examined = 0;
    let after: StaleAudit | null = null;

    // PAGED, and here not paging is worse than falling behind: `created_at`
    // never changes, so old-but-legitimately-pending candidates hold the front
    // of the list every night. An orphan behind them is never examined and its
    // page is excluded from re-audits permanently - the exact failure this
    // pass exists to prevent.
    while (examined < this.maxPagesPerRun) {
      if (stopped()) break;

      const wanted = Math.min(this.batchSize, this.maxPagesPerRun - examined);

      let candidates: StaleAudit[];
      try {
        candidates = await this.audits.loadStaleInFlight(staleBefore, wanted, after);
      } catch {
        // Never fatal - reclaiming is maintenance and the rows keep. Counted
        // rather than reported as zero, because "nothing needed reclaiming"
        // and "I could not look" are opposite facts, and conflating them hides
        // rows excluding their pages while every run looks healthy.
        return {reclaimed, failed: failed + 1};
      }

      if (candidates.length === 0) break;

      for (const candidate of candidates) {
        if (stopped()) return {reclaimed, failed};
        examined += 1;

        const verdict = await this.queueVerdict(candidate.auditId);
        if (verdict === 'pending') continue;
        if (verdict === 'unknown') {
          // Skipped, exactly as `pending` is - but COUNTED, because they are
          // not the same fact. An unreachable queue means no candidate was
          // examined at all, and reporting that as a quiet night would rebuild
          // the ambiguity this counter exists to remove, one level down from
          // where it was removed.
          failed += 1;
          continue;
        }

        try {
          if (await this.audits.markAbandoned(candidate.auditId, ABANDONED_ERROR)) reclaimed += 1;
        } catch {
          // The row stays unfinished and is a candidate again next run.
          failed += 1;
        }
      }

      after = candidates[candidates.length - 1] ?? null;
      if (candidates.length < wanted) break;
    }

    return {reclaimed, failed};
  }

  /**
   * Whether the queue still holds this audit's job - and a queue that cannot
   * answer is treated as still holding it.
   *
   * The OPPOSITE default to `audit-submission.ts`, deliberately: there an
   * unanswerable lookup costs one stray job, here it would mark a live audit
   * abandoned and schedule a second for the same page, so a Redis blip would
   * manufacture duplicate work. Waiting a day is the cheaper mistake.
   */
  private async queueVerdict(auditId: string): Promise<'pending' | 'gone' | 'unknown'> {
    try {
      // BOUNDED, because a `catch` alone does not fail closed: an unreachable
      // Redis hangs rather than rejecting, since BullMQ retries forever. One
      // dead candidate would stall the fan-out until the job timeout, and the
      // lookup would still be pending afterwards - free to resume and mutate
      // rows outside the attempt that was supposed to have ended.
      //
      // `isPending`, not `has`: a terminal job is a record BullMQ keeps for a
      // while, not work that is coming.
      const pending = await withTimeout(this.auditQueue.isPending(auditId), ENQUEUE_TIMEOUT_MS);
      return pending ? 'pending' : 'gone';
    } catch {
      // Three outcomes rather than a boolean, because "the queue says no" and
      // "the queue did not answer" call for the same ACTION and different
      // bookkeeping. Both leave the row alone - reclaiming a live audit
      // schedules a duplicate, so a Redis blip must not manufacture work out
      // of healthy rows - but only one of them is a quiet night.
      return 'unknown';
    }
  }

  /**
   * One page: create the row, then queue the job - never the reverse, since a
   * worker that dequeues an id whose row does not exist has nothing to run.
   *
   * Sequential rather than `Promise.all`: the run has hours, and a fan-out
   * opening one connection per page would take the shared pool out from under
   * the audits it just scheduled.
   */
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
      // The unique index refused it: another run already scheduled this page
      // today, and its audit is the one that should exist.
      if (audit === null) return 'skippedDuplicate';
      auditId = audit.id;
    } catch {
      // One page's insert failing must not end the night for every page after
      // it. Counted, and the handler above decides whether the run as a whole
      // is worth retrying.
      return 'failed';
    }

    const enqueued = await enqueueAudit(this.auditQueue, auditId, reauditDelayMs(page.domain, page.pageId));

    if (enqueued === 'failed') {
      // A queued audit nothing will run shows as permanently in progress and
      // keeps its page out of the worklist, so the row should go.
      //
      // Swallowed rather than retried: the outage that failed the delete would
      // fail the retry. If it fails, the reclaim pass above retires the row on
      // a later run, so the cost is one page missing one night rather than
      // monitoring stopping for good.
      //
      // `unknown` deliberately does not land here: the queue may have taken
      // the job and lost the reply, and deleting the row then would leave a
      // job pointing at an audit that no longer exists.
      await this.deleteQueuedAuditRepository.deleteIfQueued(auditId).catch(() => undefined);
      return 'failed';
    }

    return 'auditsEnqueued';
  }
}
