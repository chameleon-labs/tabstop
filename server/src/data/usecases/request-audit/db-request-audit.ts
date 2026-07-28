import { parseAuditUrl } from '../../../domain/services/url-safety.js'
import type {
  RequestAudit, RequestAuditParams, RequestAuditResult
} from '../../../domain/usecases/request-audit.js'
import type { AddAuditRepository } from '../../protocols/db/audit/add-audit-repository.js'
import type {
  DeleteQueuedAuditRepository
} from '../../protocols/db/audit/delete-queued-audit-repository.js'
import type { JobQueue } from '../../protocols/queue/job-queue.js'

export type AuditJob = { auditId: string }

const ENQUEUE_ATTEMPTS = 3
const ENQUEUE_BACKOFF_MS = 50

export class DbRequestAudit implements RequestAudit {
  constructor (
    private readonly addAuditRepository: AddAuditRepository,
    private readonly deleteQueuedAuditRepository: DeleteQueuedAuditRepository,
    private readonly auditQueue: JobQueue<AuditJob>
  ) {}

  async request ({ url }: RequestAuditParams): Promise<RequestAuditResult> {
    // Gate 1, the half of #7 left open. Syntactic only - no DNS - because this
    // endpoint is anonymous and unlimited until #8, so a lookup per request is
    // an amplifier; and because gate 2 re-resolves at fetch time anyway, which
    // is the check that actually decides.
    const parsed = parseAuditUrl(url)
    if (!parsed.safe) return { outcome: 'rejected', reason: parsed.reason }

    // Insert BEFORE enqueue. Reversed, the worker can dequeue an id whose row
    // does not exist yet.
    const audit = await this.addAuditRepository.add({
      url: parsed.url.toString(),
      pageId: null
    })

    try {
      await this.enqueueWithRetry(audit.id)
    } catch {
      // The row was acknowledged to nobody, so removing it leaves nothing
      // stranded and the client simply retries for a fresh id. If the delete
      // fails too this degrades to a queued row nothing runs - strictly better
      // than not attempting it, and the only residual.
      await this.deleteQueuedAuditRepository.deleteIfQueued(audit.id).catch(() => undefined)
      return { outcome: 'unavailable' }
    }

    return { outcome: 'queued', audit }
  }

  /** Most enqueue failures are a blip; absorbing them keeps the delete path for real outages. */
  private async enqueueWithRetry (auditId: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.auditQueue.enqueue({ auditId })
      } catch (error) {
        if (attempt >= ENQUEUE_ATTEMPTS) throw error
        await new Promise<void>((resolve) => {
          setTimeout(resolve, ENQUEUE_BACKOFF_MS * attempt).unref()
        })
      }
    }
  }
}
