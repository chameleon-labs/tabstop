import { reauditDelayMs, utcDay, utcDayStart } from '../../../domain/services/reaudit-schedule.js'
import type {
  ReauditRunSummary, RunScheduledReaudits
} from '../../../domain/usecases/run-scheduled-reaudits.js'
import { ENQUEUE_TIMEOUT_MS, enqueueAudit, withTimeout } from '../../helpers/audit-submission.js'
import type {
  AddScheduledAuditRepository
} from '../../protocols/db/audit/add-scheduled-audit-repository.js'
import type {
  DeleteQueuedAuditRepository
} from '../../protocols/db/audit/delete-queued-audit-repository.js'
import type {
  ReclaimAbandonedAuditsRepository
} from '../../protocols/db/audit/reclaim-abandoned-audits-repository.js'
import type {
  DuePage, LoadDueReauditsRepository
} from '../../protocols/db/page/load-due-reaudits-repository.js'
import type { AuditJobQueue } from '../../protocols/queue/audit-job-queue.js'

/**
 * The nightly fan-out: one audit per monitored page, spread over a window.
 *
 * A fan-out job rather than a worker - it runs no audit itself, it creates the
 * work the audit worker consumes. That separation is what lets the run finish
 * in a second while the work it scheduled takes six hours.
 *
 * IDEMPOTENT IN TWO LAYERS, because one is not enough. The eligibility query
 * excludes pages that already have work in flight, which is cheap and catches
 * every ordinary case. It is also check-then-act: two overlapping runs both
 * select the same page before either inserts. `addScheduled` returning null is
 * the second layer - the unique index refusing a day that already has an audit
 * - and it is the one that actually makes "exactly one per page per day" true.
 * The gap between the two is deliberately left open rather than papered over
 * with a lock, so the constraint stays load-bearing rather than decorative.
 */
/**
 * What the reclaim pass writes on a row whose job no longer exists.
 *
 * Deliberately silent about how far the audit got, because both live statuses
 * end up here and they got different distances: a `queued` row was never
 * picked up, while a `running` one was started by a worker that then died. The
 * fact they share - and the only one this pass established - is that nothing
 * is left to finish it.
 */
export const ABANDONED_ERROR = 'Abandoned: no job remained to finish this audit'

export class DbRunScheduledReaudits implements RunScheduledReaudits {
  constructor (
    private readonly duePages: LoadDueReauditsRepository,
    private readonly audits: AddScheduledAuditRepository & ReclaimAbandonedAuditsRepository,
    private readonly deleteQueuedAuditRepository: DeleteQueuedAuditRepository,
    private readonly auditQueue: AuditJobQueue,
    private readonly batchSize: number,
    private readonly maxPagesPerRun: number,
    private readonly staleAfterMs: number
  ) {}

  async run (now: Date, signal?: AbortSignal): Promise<ReauditRunSummary> {
    // Computed once, so every row of this run carries the same day. Derived
    // per row instead, a fan-out crossing midnight would stamp two dates and
    // both halves would pass the constraint.
    const scheduledFor = utcDay(now)
    const dayStart = utcDayStart(now)

    const summary = {
      scheduledFor,
      pagesConsidered: 0,
      auditsEnqueued: 0,
      skippedDuplicate: 0,
      failed: 0,
      abandonedReclaimed: 0,
      reclaimFailures: 0,
      truncated: false
    }

    // Read through a call rather than inline, because `aborted` flips while
    // this loop runs and the compiler narrows it on first use otherwise -
    // deciding, reasonably but wrongly here, that a second check can never be
    // true.
    const stopped = (): boolean => signal?.aborted ?? false

    // Before the worklist, so a page freed by the reclaim pass is scheduled
    // tonight rather than tomorrow.
    const reclaim = await this.reclaimAbandoned(now, stopped)
    summary.abandonedReclaimed = reclaim.reclaimed
    summary.reclaimFailures = reclaim.failed

    let after: string | null = null

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
        summary.truncated = true
        break
      }

      const remaining = this.maxPagesPerRun - summary.pagesConsidered
      if (remaining <= 0) {
        summary.truncated = true
        break
      }

      const wanted = Math.min(this.batchSize, remaining)
      // One more row than the batch, so "is there another page" is answered by
      // the query. Inferring it from a full batch cannot tell a run that was
      // cut short from one that ended on exactly the batch size.
      const rows = await this.duePages.loadDueForReaudit({
        dayStart, limit: wanted + 1, after
      })

      const batch = rows.slice(0, wanted)
      if (batch.length === 0) break

      for (const page of batch) {
        if (stopped()) {
          summary.truncated = true
          return summary
        }

        const outcome = await this.schedule(page, scheduledFor)
        summary[outcome] += 1
        summary.pagesConsidered += 1
      }

      // Keyset, not an offset: every page just scheduled has an audit in
      // flight and has dropped out of the predicate, so an offset would skip
      // exactly as many pages as this batch handled.
      after = batch[batch.length - 1]?.pageId ?? null
      if (rows.length <= wanted) break
    }

    return summary
  }

  /**
   * Retires unfinished audits that no job is ever going to run.
   *
   * This exists because an unfinished audit hides its page from every future
   * worklist, so a row left behind by a lost enqueue - or by a worker killed
   * between the insert and the enqueue - ends that page's monitoring silently
   * and permanently.
   *
   * The obvious fix, ageing rows out of the eligibility query after a fixed
   * interval, is wrong in a way worth recording: on a queue that has not
   * drained within the interval, real pending audits look abandoned too, so
   * their pages get scheduled again and each night piles more work onto a
   * backlog the workers are already behind on. Age cannot answer "is this
   * work still live" - only the queue can.
   *
   * So age is a filter and the queue is the verdict: old rows are candidates,
   * and only a candidate whose job is genuinely gone is retired. The interval
   * is therefore free to be generous; it decides how much this scans, not
   * what it concludes.
   */
  private async reclaimAbandoned (
    now: Date, stopped: () => boolean
  ): Promise<{ reclaimed: number, failed: number }> {
    const staleBefore = new Date(now.getTime() - this.staleAfterMs)

    let candidates: string[]
    try {
      candidates = await this.audits.loadStaleInFlight(staleBefore, this.batchSize)
    } catch {
      // Never fatal. Reclaiming is maintenance; failing at it must not stop
      // the night's actual work, and the same rows are still here tomorrow.
      //
      // Counted, though, and not as zero. Reporting "nothing needed
      // reclaiming" for "I could not look" would hide the one failure mode
      // this pass exists to prevent: rows that keep excluding their pages
      // while every run reports a healthy night.
      return { reclaimed: 0, failed: 1 }
    }

    let reclaimed = 0
    let failed = 0
    for (const auditId of candidates) {
      if (stopped()) break
      if (await this.queueStillHolds(auditId)) continue

      try {
        if (await this.audits.markAbandoned(auditId, ABANDONED_ERROR)) reclaimed += 1
      } catch {
        // The row stays unfinished and is a candidate again next run.
        failed += 1
      }
    }

    return { reclaimed, failed }
  }

  /**
   * Whether the queue still holds this audit's job - and a queue that cannot
   * answer is treated as still holding it.
   *
   * That direction is the opposite of the one `audit-submission.ts` takes for
   * the same question, deliberately, because the two are deciding different
   * things. There, an unanswerable lookup costs one stray job that fails once
   * and is gone. Here it would mark a live audit as abandoned and schedule a
   * second one for the same page - so a Redis blip during the nightly run
   * would manufacture duplicate work out of healthy rows. Waiting a day to
   * reclaim a genuinely dead one is much the cheaper mistake.
   */
  private async queueStillHolds (auditId: string): Promise<boolean> {
    try {
      // BOUNDED, because a `catch` alone does not implement "fails closed" -
      // an unreachable Redis does not reject here, it hangs. BullMQ configures
      // its connection to retry forever, which `audit-submission.ts` measured
      // at five minutes with no resolution. Unbounded, one dead candidate
      // would stall the fan-out until the job timeout, and the lookup would
      // still be pending afterwards - free to resume and start mutating rows
      // outside the attempt that was supposed to have ended.
      return await withTimeout(this.auditQueue.has(auditId), ENQUEUE_TIMEOUT_MS)
    } catch {
      return true
    }
  }

  /**
   * One page: create the row, then queue the job.
   *
   * In that order and never the reverse, for the reason every other submission
   * path in this codebase gives - a worker that dequeues an id whose row does
   * not exist yet has nothing to run.
   *
   * Sequential rather than a Promise.all over the whole list. The run has
   * hours, the database pool is shared with the audit worker, and a fan-out
   * that opened one connection per monitored page would take the pool out from
   * under the audits it just scheduled.
   */
  private async schedule (
    page: DuePage, scheduledFor: string
  ): Promise<'auditsEnqueued' | 'skippedDuplicate' | 'failed'> {
    let auditId: string
    try {
      const audit = await this.audits.addScheduled({
        pageId: page.pageId, url: page.url, scheduledFor
      })
      // The unique index refused it: another run already scheduled this page
      // today, and its audit is the one that should exist.
      if (audit === null) return 'skippedDuplicate'
      auditId = audit.id
    } catch {
      // One page's insert failing must not end the night for every page after
      // it. Counted, and the handler above decides whether the run as a whole
      // is worth retrying.
      return 'failed'
    }

    const enqueued = await enqueueAudit(
      this.auditQueue, auditId, reauditDelayMs(page.domain, page.pageId)
    )

    if (enqueued === 'failed') {
      // The row should go: a queued audit nothing will ever run renders on the
      // dashboard as permanently in progress, and while it exists it keeps
      // this page out of the worklist.
      //
      // If the delete fails too, the row survives and the page is out of the
      // worklist until the reclaim pass above retires it - which it will, on
      // a later run, once the row is old enough to be a candidate and the
      // queue confirms no job is behind it. Recovery is that pass, not this
      // line: the eligibility query excludes unfinished audits regardless of
      // age, deliberately, because ageing them out compounds under load.
      //
      // So the delete is swallowed rather than retried. The outage that failed
      // it would fail the retry, and the cost of not having it is one page
      // missing one night instead of monitoring stopping for good.
      //
      // `unknown` deliberately does not land here: the queue may have taken
      // the job and lost the reply, and deleting the row then would leave a
      // job pointing at an audit that no longer exists.
      await this.deleteQueuedAuditRepository.deleteIfQueued(auditId).catch(() => undefined)
      return 'failed'
    }

    return 'auditsEnqueued'
  }
}
