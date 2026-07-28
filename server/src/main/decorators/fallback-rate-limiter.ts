import type {
  BucketConfig, RateLimitDecision, RateLimiter
} from '../../data/protocols/rate-limit/rate-limiter.js'

/** An outage that logged per request would do more damage than the outage. */
const LOG_INTERVAL_MS = 30_000

/**
 * Tries the shared limiter and degrades to a local one when it cannot answer.
 *
 * The alternative - refusing the request - was rejected: it would hand an
 * attacker who can make Redis flaky a complete authentication outage, and it
 * would make the queue's health a hard dependency of logging in.
 */
export class FallbackRateLimiter implements RateLimiter {
  private lastLoggedAt = 0

  constructor (
    private readonly primary: RateLimiter,
    private readonly fallback: RateLimiter
  ) {}

  async consume (key: string, bucket: BucketConfig, cost = 1): Promise<RateLimitDecision> {
    try {
      return await this.primary.consume(key, bucket, cost)
    } catch (error) {
      this.report(error)
      return await this.fallback.consume(key, bucket, cost)
    }
  }

  async refund (key: string, bucket: BucketConfig, amount = 1): Promise<void> {
    try {
      await this.primary.refund(key, bucket, amount)
    } catch (error) {
      this.report(error)
      await this.fallback.refund(key, bucket, amount)
    }
  }

  private report (error: unknown): void {
    const now = Date.now()
    if (now - this.lastLoggedAt < LOG_INTERVAL_MS) return

    this.lastLoggedAt = now
    console.warn('Rate limiter falling back to in-process buckets:', error)
  }
}
