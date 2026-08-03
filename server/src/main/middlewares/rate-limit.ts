import { createHash } from 'node:crypto'
import ipaddr from 'ipaddr.js'
import type { NextFunction, Request, Response } from 'express'
import { toRateLimitedBody } from '../../presentation/helpers/rate-limit-view.js'
import type {
  BucketConfig, RateLimitAllowance, RateLimiter
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
    const consumed: RateLimitAllowance[] = []

    for (const rule of rules) {
      const rawKey = rule.key(req)
      if (rawKey === undefined) continue
      const key = `${rule.name}:${rawKey}`

      // The limiter the factory wires in is a FallbackRateLimiter, whose own
      // fallback does no I/O, so today nothing thrown here is reachable in
      // production. But that invariant - this middleware never 5xxs on the
      // limiter's own account - lives in that collaborator, not in this
      // function, and makeRateLimit is a public seam the unit specs already
      // inject bare mocks into. A throwing limiter must fail *open*, the
      // same direction FallbackRateLimiter itself fails in.
      let decision
      try {
        decision = await limiter.consume(key, rule.bucket)
      } catch (error) {
        console.warn('Rate limiter threw on consume; failing open:', error)
        continue
      }
      if (decision.allowed) {
        consumed.push(decision)
        continue
      }

      // Give back what the earlier rules took. Without this, one attacker
      // exhausting a per-email bucket would also drain the per-IP bucket
      // shared by everyone behind that address.
      await Promise.all(consumed.map(async (taken) => {
        try {
          await taken.refund()
        } catch (error) {
          console.warn('Rate limiter refund failed; preserving denial:', error)
        }
      }))

      // Whole seconds - the header admits no other unit - and never zero,
      // which would invite an immediate retry.
      const retryAfter = Math.max(1, Math.ceil(decision.retryAfterMs / 1000))
      res.set('retry-after', String(retryAfter))
      // Built by a view helper, so the body carries the type the frontend
      // compiles against instead of being an inline object that resembles it.
      res.status(429).json(toRateLimitedBody(retryAfter, new Date()))
      return
    }

    next()
  }
}

/**
 * The key never needs to be read back - only compared - so there is no
 * reason to store the address in the clear. Redis is shared with BullMQ
 * here, and `rl:loginEmail:email:bob@example.com` handed anyone with SCAN,
 * a leaked RDB, or MONITOR/slowlog output a list of every address that has
 * ever attempted to log in, typos included. The `email:` prefix stays so
 * the key shape is still legible as "this is an email bucket" without
 * revealing which email.
 */
const hashEmail = (normalised: string): string =>
  createHash('sha256').update(normalised).digest('hex').slice(0, 32)

/** Trimmed and lowercased to match the zod schema in account-validation-factory.ts. */
export const emailKey = (req: Request): string | undefined => {
  const email = (req.body as { email?: unknown } | undefined)?.email
  if (typeof email !== 'string') return undefined

  const normalised = email.trim().toLowerCase()
  return normalised === '' ? undefined : `email:${hashEmail(normalised)}`
}

/**
 * IPv6 is routed to end users in blocks of at least a /64 (every major
 * hosting provider and residential ISP), not as single /128 addresses. Keyed
 * on the full address, one attacker on one host mints an unlimited number of
 * buckets simply by incrementing the interface identifier -
 * 2001:db8:aaaa:1::1, ::2, ::3, ... - each starting fresh at full capacity.
 * IPv4 has no such elasticity: an address is the allocation unit, so it
 * passes through unchanged. An IPv4-mapped IPv6 address (::ffff:a.b.c.d) is
 * unwrapped to its IPv4 form for the same reason, rather than truncated as
 * if it were a native v6 address.
 */
const IPV6_BUCKET_PREFIX_GROUPS = 4 // 4 * 16 bits = /64

const normaliseIp = (ip: string): string => {
  let parsed
  try {
    parsed = ipaddr.parse(ip)
  } catch {
    // req.ip comes from proxy-addr, which is trusted to hand back a valid
    // address or undefined - but a defensive key beats a 500 if it ever
    // does not, so a malformed address is used as-is rather than thrown on.
    return ip
  }

  if (parsed instanceof ipaddr.IPv4) return parsed.toNormalizedString()
  if (parsed.isIPv4MappedAddress()) return parsed.toIPv4Address().toNormalizedString()

  const prefix = new ipaddr.IPv6([
    ...parsed.parts.slice(0, IPV6_BUCKET_PREFIX_GROUPS),
    0, 0, 0, 0
  ])
  return prefix.toNormalizedString()
}

/**
 * Never undefined: an unidentifiable requester (proxy-addr returns undefined
 * when the socket was already destroyed) must share a bucket with every
 * other unidentifiable requester rather than being exempt from the limit
 * entirely. That is the right default for ipKey specifically - it differs
 * from emailKey, where "no key" legitimately means "this rule does not
 * apply", because a body with no email is the controller's 400 to issue.
 */
export const ipKey = (req: Request): string =>
  `ip:${req.ip === undefined ? 'unknown' : normaliseIp(req.ip)}`
