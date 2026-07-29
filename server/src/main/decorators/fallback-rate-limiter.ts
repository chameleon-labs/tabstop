import type {
  BucketConfig, RateLimitDecision, RateLimiter
} from '../../data/protocols/rate-limit/rate-limiter.js'

/** An outage that logged per request would do more damage than the outage. */
const LOG_INTERVAL_MS = 30_000

/**
 * How long one failure keeps traffic on the fallback before the primary is
 * tried again.
 *
 * It exists for `refund`. `makeRateLimit` consumes from several buckets and
 * gives the earlier ones back when a later one rejects, and that pair has to
 * land on the same backend: without a window, a consume served by memory
 * because Redis was down, followed a millisecond later by a refund that finds
 * Redis back up, leaves the memory bucket permanently debited and hands Redis
 * a token nobody took. A window comfortably longer than a request makes both
 * halves see the same state.
 *
 * It also stops a dead Redis from charging every single request its command
 * timeout before the fallback runs, which is the difference between degraded
 * and unusable.
 *
 * What it costs is up to this long of per-instance counting after Redis
 * actually recovers - the same thing the fallback costs generally, and the
 * reason it is seconds rather than minutes.
 */
const DEGRADED_WINDOW_MS = 5_000

/**
 * Tries the shared limiter and degrades to a local one when it cannot answer.
 *
 * The alternative - refusing the request - was rejected: it would hand an
 * attacker who can make Redis flaky a complete authentication outage, and it
 * would make the queue's health a hard dependency of logging in.
 */
export class FallbackRateLimiter implements RateLimiter {
  private lastLoggedAt = 0
  private degradedUntil = 0

  constructor (
    private readonly primary: RateLimiter,
    private readonly fallback: RateLimiter
  ) {}

  async consume (key: string, bucket: BucketConfig, cost = 1): Promise<RateLimitDecision> {
    if (this.degraded()) return await this.fallback.consume(key, bucket, cost)

    try {
      return await this.primary.consume(key, bucket, cost)
    } catch (error) {
      this.degrade(error)
      return await this.fallback.consume(key, bucket, cost)
    }
  }

  async refund (key: string, bucket: BucketConfig, amount = 1): Promise<void> {
    if (this.degraded()) {
      await this.fallback.refund(key, bucket, amount)
      return
    }

    try {
      await this.primary.refund(key, bucket, amount)
    } catch (error) {
      this.degrade(error)
      // Refunding a bucket the fallback never debited is harmless: both
      // implementations cap a refund at the bucket's capacity, so the worst
      // it can do is leave an untouched bucket untouched.
      await this.fallback.refund(key, bucket, amount)
    }
  }

  private degraded (): boolean {
    return Date.now() < this.degradedUntil
  }

  private degrade (error: unknown): void {
    this.degradedUntil = Date.now() + DEGRADED_WINDOW_MS
    this.report(error)
  }

  private report (error: unknown): void {
    const now = Date.now()
    if (now - this.lastLoggedAt < LOG_INTERVAL_MS) return

    this.lastLoggedAt = now
    console.warn('Rate limiter falling back to in-process buckets:', error)
  }
}
