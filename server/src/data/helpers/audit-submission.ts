import { bareHostname, type UrlPolicy } from '../../domain/services/url-safety.js'
import type { DnsResolver } from '../protocols/net/dns-resolver.js'
import type { AuditJobQueue } from '../protocols/queue/audit-job-queue.js'

const ENQUEUE_ATTEMPTS = 3
const ENQUEUE_BACKOFF_MS = 50

/**
 * Bounds a single call into the queue.
 *
 * BullMQ retries a lost Redis forever, so `add` hangs rather than rejecting.
 * Measured at five minutes with no resolution, and `enableOfflineQueue: false`
 * does not change it. Unbounded, the recovery path below is unreachable and
 * the request never answers.
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
 * Defence in depth, not the boundary - the worker re-resolves at fetch time
 * because this answer cannot be trusted by then. It buys refusing what is
 * already known to be wrong before it costs a queued job, a browser launch and
 * thirty seconds, nightly for a monitored page. One lookup per call, affordable
 * only because a rate limit sits in front of every caller.
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
 * Three outcomes rather than a boolean, because the two failures call for
 * opposite responses and only the caller knows which it wants.
 *
 * `unknown` is the one that matters: Redis may have committed the job and lost
 * the reply, so a caller that cleans up on `failed` must not clean up here, or
 * it leaves a job pointing at a row that no longer exists.
 */
export type EnqueueOutcome = 'queued' | 'unknown' | 'failed'

/**
 * Most enqueue failures are a blip; absorbing them keeps cleanup for real
 * outages.
 *
 * `delayMs` is how long the queue holds the job before a worker may take it -
 * zero for anything a person waits on, the scheduler's per-domain jitter for a
 * re-audit. It changes no retry semantics: the job is enqueued when `add`
 * returns, and the delay is a property of the job rather than of getting there.
 */
export const enqueueAudit = async (
  queue: AuditJobQueue, auditId: string, delayMs = 0
): Promise<EnqueueOutcome> => {
  // The options argument is left off entirely when there is no delay, rather
  // than passed as an explicit undefined, so an interactive submission calls
  // the queue exactly as it always has - one argument, no job options to
  // decide about. Deduped on the audit id either way, so a retry after a lost
  // reply enqueues once.
  const submit = async (): Promise<void> => {
    if (delayMs <= 0) {
      await queue.enqueueOnce({ auditId })
      return
    }
    await queue.enqueueOnce({ auditId }, { delayMs })
  }

  for (let attempt = 1; ; attempt++) {
    try {
      await withTimeout(submit(), ENQUEUE_TIMEOUT_MS)
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
 * Bounded, and a queue that cannot answer is treated as NOT holding the job -
 * so the caller cleans up.
 *
 * The residuals are asymmetric and the common case decides it. Failing toward
 * cleanup, a stray job's next delivery finds no audit, raises
 * PermanentAuditError, fails once and is gone. Failing the other way - Redis
 * simply down, nothing ever enqueued - leaves a `queued` row nothing will run:
 * a client polling a 202 forever, and no sweeper to reap it.
 *
 * So the rare interleaving costs one logged failure, whereas the common outage
 * would cost a permanent lie. A confirmed `has === true` still keeps the row;
 * what this refuses is to read "I could not measure" as "it is there".
 */
const queueAlreadyHas = async (queue: AuditJobQueue, auditId: string): Promise<boolean> => {
  try {
    return await withTimeout(queue.has(auditId), ENQUEUE_TIMEOUT_MS)
  } catch {
    return false
  }
}
