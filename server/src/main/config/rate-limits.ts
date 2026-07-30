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
  me: { capacity: 60, refillPerHour: 600 },
  /**
   * Adding a page is ~30s of Chromium, the same cost the anonymous audit
   * bucket is sized for - so this is the tightest bucket on the pages router
   * by a distance. The ten-page cap bounds how many an account can HOLD, not
   * how many times it can ask: add, delete, add again is free of the cap and
   * not free of the audit.
   *
   * Not tied to `audit`, whose capacity is an operator dial for anonymous
   * traffic. A signed-in account's tenth page should not be refused because a
   * deploy widened the anonymous allowance, or vice versa.
   */
  pageAdd: { capacity: 10, refillPerHour: 20 },
  /**
   * Pause/resume and delete: one indexed statement each.
   *
   * Two entries with identical numbers rather than one name on both routes,
   * because the route table asserts that a name is used exactly once - a rule
   * worth keeping strict, since the collisions it catches are typos. Separate
   * counters are also the friendlier behaviour: a client that has been
   * removing pages has not thereby spent its budget for pausing them.
   */
  pageUpdate: { capacity: 30, refillPerHour: 120 },
  pageDelete: { capacity: 30, refillPerHour: 120 },
  /** The dashboard's only call, and it is polled rather than fetched once. */
  pageRead: { capacity: 60, refillPerHour: 600 },
  /**
   * The trend chart (#21). Sized like pageRead - it is a read of the same
   * order, bounded by the same 365-day ceiling - but named separately, because
   * the route table asserts one name per bucket and #47 recorded why that
   * stays strict. Its own counter also means opening a chart cannot spend the
   * budget the dashboard behind it needs.
   */
  pageHistory: { capacity: 60, refillPerHour: 600 }
} as const satisfies Record<string, BucketConfig>
