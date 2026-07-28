import type { NextFunction, Request, Response } from 'express'
import type {
  BucketConfig, RateLimiter
} from '../../data/protocols/rate-limit/rate-limiter.js'

export type RateLimitRule = {
  /**
   * Both token bucket implementations key their storage purely on the string
   * handed to `consume`/`refund` - they never see the BucketConfig alongside
   * it. `ipKey`/`emailKey` return the same string regardless of which named
   * bucket calls them, so without this prefix, e.g. RATE_LIMITS.auditRead and
   * RATE_LIMITS.me - which happen to share a capacity and refill rate, so the
   * collision would not even be visible from the numbers - would silently
   * share one counter per address. Required, not optional, so a new rule
   * cannot be wired up without picking a namespace: the type system is what
   * makes the collision unconstructable rather than merely undocumented.
   */
  name: string
  bucket: BucketConfig
  /** Undefined means this rule does not apply to this request. */
  key: (req: Request) => string | undefined
}

/**
 * Runs before the controller, deliberately. On login that keeps the limiter
 * from becoming an early return that skips the dummy scrypt verify - the
 * mechanism that stops response time revealing whether an account exists.
 */
export const makeRateLimit = (limiter: RateLimiter, rules: RateLimitRule[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const consumed: Array<{ key: string, bucket: BucketConfig }> = []

    for (const rule of rules) {
      const rawKey = rule.key(req)
      if (rawKey === undefined) continue
      const key = `${rule.name}:${rawKey}`

      const decision = await limiter.consume(key, rule.bucket)
      if (decision.allowed) {
        consumed.push({ key, bucket: rule.bucket })
        continue
      }

      // Give back what the earlier rules took. Without this, one attacker
      // exhausting a per-email bucket would also drain the per-IP bucket
      // shared by everyone behind that address.
      await Promise.all(consumed.map(async (taken) =>
        { await limiter.refund(taken.key, taken.bucket) }
      ))

      // Whole seconds - the header admits no other unit - and never zero,
      // which would invite an immediate retry.
      const retryAfter = Math.max(1, Math.ceil(decision.retryAfterMs / 1000))
      res.set('retry-after', String(retryAfter))
      res.status(429).json({
        error: 'Too many requests',
        retryAfter,
        // Absolute, because a countdown is what a UI can render without
        // tracking when the response arrived.
        resetAt: new Date(Date.now() + retryAfter * 1000).toISOString()
      })
      return
    }

    next()
  }
}

/** Trimmed and lowercased to match the zod schema in account-validation-factory.ts. */
export const emailKey = (req: Request): string | undefined => {
  const email = (req.body as { email?: unknown } | undefined)?.email
  if (typeof email !== 'string') return undefined

  const normalised = email.trim().toLowerCase()
  return normalised === '' ? undefined : `email:${normalised}`
}

export const ipKey = (req: Request): string | undefined =>
  req.ip === undefined ? undefined : `ip:${req.ip}`
