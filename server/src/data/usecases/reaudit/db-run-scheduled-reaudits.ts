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
export class DbRunScheduledReaudits implements RunScheduledReaudits {
  constructor (
    private readonly duePages: LoadDueReauditsRepository,
    private readonly audits: AddScheduledAuditRepository,
    private readonly deleteQueuedAuditRepository: DeleteQueuedAuditRepository,
    private readonly auditQueue: AuditJobQueue,
    private readonly maxPagesPerRun: number
  ) {}

  async run (now: Date): Promise<ReauditRunSummary> {
    // Computed once, so every row of this run carries the same day. Derived
    // per row instead, a fan-out crossing midnight would stamp two dates and
    // both halves would pass the constraint.
    const scheduledFor = utcDay(now)
    const due = await this.duePages.loadDueForReaudit(utcDayStart(now), this.maxPagesPerRun)

    const summary = {
      scheduledFor,
      pagesConsidered: due.length,
      auditsEnqueued: 0,
      skippedDuplicate: 0,
      failed: 0,
      truncated: due.length >= this.maxPagesPerRun
    }

    // How many pages of this domain the run has already placed, so several
    // pages on one host are serialised rather than arriving together.
    const placed = new Map<string, number>()

    for (const page of due) {
      const position = placed.get(page.domain) ?? 0
      placed.set(page.domain, position + 1)

      const outcome = await this.schedule(page, position, scheduledFor)
      summary[outcome] += 1
    }

    return summary
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
      // The row must go. A queued audit nothing will ever run renders on the
      // dashboard as permanently in progress, and it would keep this page out
      // of the eligibility query - so a lost enqueue would cost the page every
      // future night as well, not just this one.
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
