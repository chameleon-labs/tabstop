import { bareHostname, type UrlPolicy } from '../../domain/services/url-safety.js'
import type { DnsResolver } from '../protocols/net/dns-resolver.js'
import type { AuditJobQueue } from '../protocols/queue/audit-job-queue.js'

const ENQUEUE_ATTEMPTS = 3
const ENQUEUE_BACKOFF_MS = 50

/**
 * Bounds a single call into the queue.
 *
 * BullMQ configures its connection to retry a lost Redis forever, so `add`
 * does not reject when Redis is down - it hangs. Measured: five minutes with
 * no resolution, and `enableOfflineQueue: false` does not change it. Without
 * this bound the retry-and-recover path below is unreachable and the request
 * simply never answers.
 */
export const ENQUEUE_TIMEOUT_MS = 2000

export const withTimeout = async <T>(work: Promise<T>, ms: number): Promise<T> =>
  await Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => { reject(new Error('Timed out talking to the queue')) }, ms).unref()
    })
  ])

/**
 * Whether every address the host resolves to is safe to fetch.
 *
 * This is defence in depth rather than the boundary: the worker re-resolves at
 * fetch time, because this answer cannot be trusted by then. What it buys is
 * refusing what is ALREADY known to be wrong before it becomes a queued job, a
 * browser launch and a failed audit thirty seconds later - and, for a
 * monitored page, before it becomes that every night.
 *
 * It costs a lookup per call, which is only affordable because a rate limit
 * sits in front of every caller.
 */
export const resolvesSafely = async (
  url: URL, dnsResolver: DnsResolver, urlPolicy: UrlPolicy
): Promise<boolean> => {
  const host = bareHostname(url)
  // A literal address was already checked by parseAuditUrl.
  if (urlPolicy.isIpLiteral(host)) return true

  const addresses = await dnsResolver.resolve(host)
  // Empty means resolution failed: fail closed. And every address must be
  // safe - a host answering with one public and one private is a rebinding
  // attempt, not a coincidence.
  return addresses.length > 0 && addresses.every(
    (address) => !urlPolicy.isBlockedAddress(address)
  )
}

/**
 * Three outcomes rather than a boolean or a throw, because the two failures
 * call for opposite responses and only the caller knows which it wants.
 *
 * `unknown` is the one that matters: failing to confirm an enqueue is not the
 * same as it not happening - Redis may have committed the job and lost the
 * reply - so a caller that would clean up on `failed` must not clean up here,
 * or it leaves a job pointing at a row that no longer exists.
 */
export type EnqueueOutcome = 'queued' | 'unknown' | 'failed'

/** Most enqueue failures are a blip; absorbing them keeps cleanup for real outages. */
export const enqueueAudit = async (
  queue: AuditJobQueue, auditId: string
): Promise<EnqueueOutcome> => {
  for (let attempt = 1; ; attempt++) {
    try {
      // Deduped on the audit id, so a retry after a lost reply enqueues once.
      await withTimeout(queue.enqueueOnce({ auditId }), ENQUEUE_TIMEOUT_MS)
      return 'queued'
    } catch {
      if (attempt >= ENQUEUE_ATTEMPTS) break
      await new Promise<void>((resolve) => {
        setTimeout(resolve, ENQUEUE_BACKOFF_MS * attempt).unref()
      })
    }
  }

  return await queueAlreadyHas(queue, auditId) ? 'unknown' : 'failed'
}

/**
 * Whether the queue already holds this job. Bounded and best-effort: a queue
 * that cannot answer is treated as not holding it, so the caller is free to
 * clean up - a job that fails once with "audit no longer exists" is a better
 * outcome than a row nothing ever recovers.
 */
const queueAlreadyHas = async (queue: AuditJobQueue, auditId: string): Promise<boolean> => {
  try {
    return await withTimeout(queue.has(auditId), ENQUEUE_TIMEOUT_MS)
  } catch {
    return false
  }
}
