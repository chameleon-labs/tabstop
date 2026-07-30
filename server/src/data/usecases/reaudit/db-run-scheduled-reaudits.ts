import { reauditDelayMs, utcDay, utcDayStart } from '../../../domain/services/reaudit-schedule.js'
import type {
  ReauditRunSummary, RunScheduledReaudits
} from '../../../domain/usecases/run-scheduled-reaudits.js'
import { enqueueAudit } from '../../helpers/audit-submission.js'
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
/** What the reaper writes on a row whose job no longer exists. */
export const ABANDONED_ERROR = 'Abandoned: the audit was queued but no job ever ran it'

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
      truncated: false
    }

    // Read through a call rather than inline, because `aborted` flips while
    // this loop runs and the compiler narrows it on first use otherwise -
    // deciding, reasonably but wrongly here, that a second check can never be
    // true.
    const stopped = (): boolean => signal?.aborted ?? false

    // Before the worklist, so a page freed by the reaper is scheduled tonight
    // rather than tomorrow.
    summary.abandonedReclaimed = await this.reclaimAbandoned(now, stopped)

    // How many pages of this domain the run has already placed, so several
    // pages on one host are serialised rather than arriving together. Held
    // across batches, or a domain straddling a batch boundary would restart
    // its stagger and put two of its pages on the same instant.
    const placed = new Map<string, number>()
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

        const position = placed.get(page.domain) ?? 0
        placed.set(page.domain, position + 1)

        const outcome = await this.schedule(page, position, scheduledFor)
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
  private async reclaimAbandoned (now: Date, stopped: () => boolean): Promise<number> {
    const staleBefore = new Date(now.getTime() - this.staleAfterMs)

    let candidates: string[]
    try {
      candidates = await this.audits.loadStaleInFlight(staleBefore, this.batchSize)
    } catch {
      // Never fatal. Reclaiming is maintenance; failing at it must not stop
      // the night's actual work, and the same rows are still here tomorrow.
      return 0
    }

    let reclaimed = 0
    for (const auditId of candidates) {
      if (stopped()) break
      if (await this.queueStillHolds(auditId)) continue

      try {
        if (await this.audits.markAbandoned(auditId, ABANDONED_ERROR)) reclaimed += 1
      } catch {
        // The row stays unfinished and is a candidate again next run.
      }
    }

    return reclaimed
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
      return await this.auditQueue.has(auditId)
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
    page: DuePage, position: number, scheduledFor: string
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
      this.auditQueue, auditId, reauditDelayMs(page.domain, position)
    )

    if (enqueued === 'failed') {
      // The row should go: a queued audit nothing will ever run renders on the
      // dashboard as permanently in progress, and while it exists it keeps
      // this page out of the worklist.
      //
      // Swallowing a failed delete is safe only because that exclusion is time
      // bounded. If both the enqueue and the cleanup fail, the row survives -
      // and the eligibility query ignores unfinished audits older than the
      // grace window, so the page returns to the worklist on its own instead
      // of being hidden by a row nothing will ever finish. Retrying the
      // deletion here could not close that gap anyway: the same outage that
      // failed it would fail the retry.
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
