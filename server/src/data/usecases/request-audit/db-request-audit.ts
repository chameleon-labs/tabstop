import { isIP } from 'node:net'
import {
  DEFAULT_URL_POLICY, bareHostname, parseAuditUrl, type UrlPolicy
} from '../../../domain/services/url-safety.js'
import type { DnsResolver } from '../../protocols/net/dns-resolver.js'
import type {
  RequestAudit, RequestAuditParams, RequestAuditResult
} from '../../../domain/usecases/request-audit.js'
import type { AddAuditRepository } from '../../protocols/db/audit/add-audit-repository.js'
import type {
  DeleteQueuedAuditRepository
} from '../../protocols/db/audit/delete-queued-audit-repository.js'
import type { AuditJobQueue } from '../../protocols/queue/audit-job-queue.js'

const ENQUEUE_ATTEMPTS = 3
const ENQUEUE_BACKOFF_MS = 50

/**
 * Bounds a single enqueue attempt.
 *
 * BullMQ configures its connection to retry a lost Redis forever, so `add`
 * does not reject when Redis is down - it hangs. Measured: five minutes with
 * no resolution, and `enableOfflineQueue: false` does not change it. Without
 * this bound the whole retry-and-recover path below is unreachable and the
 * request simply never answers.
 */
const ENQUEUE_TIMEOUT_MS = 2000

/**
 * Roughly an hour of backlog at the default concurrency of one, so a client
 * that IS accepted still gets a result rather than a place in a line nobody
 * will reach. Overridable, because the right number depends on worker count.
 */
const DEFAULT_MAX_QUEUE_DEPTH = 100

const withTimeout = async <T>(work: Promise<T>, ms: number): Promise<T> =>
  await Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => { reject(new Error('Timed out talking to the queue')) }, ms).unref()
    })
  ])

export class DbRequestAudit implements RequestAudit {
  constructor (
    private readonly addAuditRepository: AddAuditRepository,
    private readonly deleteQueuedAuditRepository: DeleteQueuedAuditRepository,
    private readonly auditQueue: AuditJobQueue,
    private readonly dnsResolver: DnsResolver,
    private readonly urlPolicy: UrlPolicy = DEFAULT_URL_POLICY,
    private readonly maxQueueDepth: number = DEFAULT_MAX_QUEUE_DEPTH
  ) {}

  async request ({ url }: RequestAuditParams): Promise<RequestAuditResult> {
    // Gate 1, the half of #7 left open by the worker-side guard.
    const parsed = parseAuditUrl(url, this.urlPolicy)
    if (!parsed.safe) return { outcome: 'rejected', reason: parsed.reason }

    // Resolved as well as parsed. A hostname that answers with a private
    // address is rejected here rather than becoming a queued job, a browser
    // launch and a failed audit thirty seconds later.
    //
    // This costs a lookup per accepted request, which is only affordable
    // because the per-IP rate limit in front of this endpoint bounds how
    // often it runs. Gate 2 still re-resolves at fetch time: this answer
    // cannot be trusted by then, it merely rejects what is already known to
    // be wrong.
    if (!await this.resolvesSafely(parsed.url)) {
      return { outcome: 'rejected', reason: 'blocked-address' }
    }

    // The gap a per-IP bucket cannot close. That bucket bounds ONE source,
    // and the queue is shared by every source: enough distinct addresses,
    // each politely inside its own allowance, still drive the backlog to
    // whatever length they collectively want. Nothing downstream refuses it
    // either - AUDIT_CONCURRENCY bounds how many audits RUN at once, not how
    // many wait, and each waiting one is a Redis job plus a row somebody is
    // polling for a result that is hours away.
    //
    // Checked here, after the url has been accepted and before the insert:
    // a rejected url still gets its own specific message rather than a
    // generic "try again later", and a refusal strands no row.
    if (await this.queueIsSaturated()) return { outcome: 'unavailable' }

    // Insert BEFORE enqueue. Reversed, the worker can dequeue an id whose row
    // does not exist yet.
    const audit = await this.addAuditRepository.add({
      url: parsed.url.toString(),
      pageId: null
    })

    try {
      await this.enqueueWithRetry(audit.id)
    } catch {
      // Failing to confirm an enqueue is not the same as it not happening:
      // Redis may have committed the job and lost the reply. Deleting the row
      // then would leave a job pointing at an audit that no longer exists.
      if (await this.queueAlreadyHas(audit.id)) return { outcome: 'queued', audit }

      // Genuinely not queued. The row was acknowledged to nobody, so removing
      // it strands nothing and the client retries for a fresh id. If the
      // delete fails too this degrades to a queued row nothing runs, which is
      // the only residual.
      await this.deleteQueuedAuditRepository.deleteIfQueued(audit.id).catch(() => undefined)
      return { outcome: 'unavailable' }
    }

    return { outcome: 'queued', audit }
  }

  /**
   * Bounded, best-effort, and a SOFT edge - it fails open, and it does not
   * make the cap exact.
   *
   * Reading the depth and then enqueueing is check-then-act: everything
   * already in flight has passed the check, so a burst of simultaneous
   * submissions - across instances too - all get in, and the queue lands over
   * the cap by roughly the size of the burst. What is bounded is the steady
   * state: every request arriving afterwards sees the raised depth and is
   * refused, so the queue spikes and drains rather than growing without
   * limit. That is the property this exists for.
   *
   * Making the edge hard needs an atomic reservation in Redis, released on
   * both the insert and the enqueue failing, with a TTL for the process dying
   * in between. That is a distributed semaphore - and to respect this
   * branch's rule that Redis is not a hard dependency of the write path it
   * would have to fail open, at which point it is not atomic when it matters
   * either. Pinned by a spec so the limitation is understood rather than
   * assumed away.
   *
   * A depth check that cannot answer must not become a second way for a sick
   * Redis to refuse submissions. The enqueue below already handles a queue
   * that is genuinely unreachable, and it does so by retrying first - whereas
   * treating "I could not measure" as "it is full" would make an unmeasurable
   * queue indistinguishable from a saturated one, and turn a Redis blip into
   * a blanket 503 on the endpoint that is the product's hook.
   */
  private async queueIsSaturated (): Promise<boolean> {
    try {
      const waiting = await withTimeout(this.auditQueue.waitingCount(), ENQUEUE_TIMEOUT_MS)
      return waiting >= this.maxQueueDepth
    } catch {
      return false
    }
  }

  private async resolvesSafely (url: URL): Promise<boolean> {
    const host = bareHostname(url)
    // A literal address was already checked by parseAuditUrl.
    if (isIP(host) !== 0) return true

    const addresses = await this.dnsResolver.resolve(host)
    // Empty means resolution failed: fail closed. And every address must be
    // safe - a host answering with one public and one private is a rebinding
    // attempt, not a coincidence.
    return addresses.length > 0 && addresses.every(
      (address) => !this.urlPolicy.isBlockedAddress(address)
    )
  }

  /**
   * Whether the queue already holds this job. Bounded and best-effort: if the
   * queue cannot answer, treat it as absent and let the row be removed - a job
   * that fails once with "audit no longer exists" is a better outcome than a
   * row nothing ever recovers.
   */
  private async queueAlreadyHas (auditId: string): Promise<boolean> {
    try {
      return await withTimeout(this.auditQueue.has(auditId), ENQUEUE_TIMEOUT_MS)
    } catch {
      return false
    }
  }

  /** Most enqueue failures are a blip; absorbing them keeps the delete path for real outages. */
  private async enqueueWithRetry (auditId: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        // Deduped on the audit id, so a retry after a lost reply enqueues once.
        return await withTimeout(
          this.auditQueue.enqueueOnce({ auditId }),
          ENQUEUE_TIMEOUT_MS
        )
      } catch (error) {
        if (attempt >= ENQUEUE_ATTEMPTS) throw error
        await new Promise<void>((resolve) => {
          setTimeout(resolve, ENQUEUE_BACKOFF_MS * attempt).unref()
        })
      }
    }
  }
}
