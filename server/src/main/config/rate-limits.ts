import { env } from './env.js'
import type { BucketConfig } from '../../data/protocols/rate-limit/rate-limiter.js'

/**
 * Constants rather than environment variables. Twelve variables to express six
 * buckets would be more parsing and validation than the limiter itself, for
 * knobs nobody has asked to turn - and this repo deploys from git, so changing
 * one of these is a commit either way.
 *
 * The anonymous audit bucket is the exception: it is the cost dial, and worth
 * turning without a deploy.
 */
export const RATE_LIMITS = {
  /** ~30s of Chromium per accepted request. Refill, not burst, sets the ceiling. */
  audit: { capacity: env.auditRateCapacity, refillPerHour: env.auditRatePerHour },
  /** Public and cache-fronted, but cold reads still hit Postgres. */
  auditRead: { capacity: 60, refillPerHour: 600 },
  /** ~89ms of scrypt per attempt, on a four-thread pool. */
  login: { capacity: 10, refillPerHour: 30 },
  /** Keyed on the submitted address: per-IP alone misses credential stuffing. */
  loginEmail: { capacity: 5, refillPerHour: 10 },
  signup: { capacity: 3, refillPerHour: 5 },
  /**
   * Deliberately the loosest bucket here, because logout must not become a
   * thing a real client can fail at: signing out is idempotent and a person
   * with several tabs may fire it more than once. But every call carrying a
   * cookie is an indexed DELETE, and "idempotent" says nothing about load -
   * an anonymous caller can drive them as fast as it can open sockets. 30 is
   * far past any genuine client and far below a useful amount of traffic.
   */
  logout: { capacity: 30, refillPerHour: 120 },
  /** The auth middleware looks the session up before rejecting it. */
  me: { capacity: 60, refillPerHour: 600 }
} as const satisfies Record<string, BucketConfig>
