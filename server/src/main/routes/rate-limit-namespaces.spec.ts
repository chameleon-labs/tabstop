import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Router } from 'express'
import type { BucketConfig } from '../../data/protocols/rate-limit/rate-limiter.js'
import type { RateLimitRule } from '../middlewares/rate-limit.js'
import { RATE_LIMITS } from '../config/rate-limits.js'

/**
 * The collision DECISIONS.md leaves open, closed at the level it lives at.
 *
 * `makeRateLimit` prefixes every storage key with the rule's `name`, and the
 * field is required, so a MISSING namespace is unconstructable. But `name` is
 * a bare string, so two rules can still agree by typo or copy-paste: `/me`
 * reusing `'login'` compiles, passes every existing spec, and silently makes
 * one address's `/me` polling drain the bucket that defends scrypt.
 *
 * The reason no existing spec catches it is structural rather than an
 * oversight - it is a property of the route TABLE, invisible from inside any
 * one route's spec. So this reads the whole table.
 *
 * Mutation-checked, which is the only thing that makes a spec like this worth
 * keeping. The two mutations do not behave the same way, and the difference
 * is the point:
 *
 * Renaming the `/me` rule to `'login'` turns the first two assertions red
 * immediately and by name. It does NOT leave the rest of the suite green,
 * contrary to the note in DECISIONS.md: `account-routes.test.ts`'s login
 * timing spec times out after 30 seconds, because the `/me` calls earlier in
 * that file drain the now-shared `login` bucket and the attempts it measures
 * come back 429. So that collision was already detectable - just 30 seconds
 * later, from a spec about scrypt timing, pointing nowhere near a namespace.
 *
 * Naming a rule after a bucket that does not exist - `'signupp'` - turns the
 * third assertion red and leaves the other 486 tests entirely green
 * (measured). Nothing else in the suite notices at all, because the key
 * prefix is still unique and the bucket is still passed by reference: the
 * name has simply stopped describing what it limits. That one is the
 * stronger argument for keeping this file.
 */

// The real factory opens a Redis connection the moment it is called, and
// registering a route calls it.
vi.mock('../factories/middlewares/rate-limit-factory.js', () => ({
  makeRateLimiter: () => ({
    consume: async () => ({ allowed: true as const, remaining: 1 }),
    refund: async () => undefined
  })
}))

const recorded: RateLimitRule[] = []

vi.mock('../middlewares/rate-limit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middlewares/rate-limit.js')>()
  return {
    ...actual,
    makeRateLimit: (
      limiter: Parameters<typeof actual.makeRateLimit>[0], rules: RateLimitRule[]
    ) => {
      recorded.push(...rules)
      return actual.makeRateLimit(limiter, rules)
    }
  }
})

/** Enough Router to register against; nothing here ever handles a request. */
const recordingRouter = (): Router => {
  const router = {} as Router
  const noop = (): Router => router
  return Object.assign(router, {
    get: noop, post: noop, put: noop, patch: noop, delete: noop, use: noop
  })
}

/**
 * Registering a route builds its controllers, and those reach for the pool -
 * so the connection has to be established against the SAME module instance the
 * route modules will import, which is why it happens here rather than in a
 * beforeAll that `vi.resetModules()` would disconnect from.
 */
const collectRules = async (): Promise<RateLimitRule[]> => {
  recorded.length = 0

  const url = process.env.DATABASE_URL
  if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')

  const database = await import('../config/database.js')
  database.connectDatabase(url)

  try {
    const modules = await Promise.all([
      import('./account-routes.js'),
      import('./audit-routes.js'),
      import('./health-check-routes.js')
    ])

    for (const module of modules) {
      module.default(recordingRouter())
    }
    return [...recorded]
  } finally {
    await database.disconnectDatabase()
  }
}

describe('rate limit namespaces', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('gives every rule in the route table its own name', async () => {
    const names = (await collectRules()).map((rule) => rule.name)

    // Guards the guard: a route table that stopped registering any rules at
    // all would otherwise satisfy every assertion below vacuously.
    expect(names.length).toBeGreaterThan(0)
    expect([...new Set(names)]).toHaveLength(names.length)
  })

  it('never lets one name stand for two different buckets', async () => {
    // The sharper half, and the reason uniqueness alone is not the whole
    // rule. Two rules sharing a name share a counter, and the damage is worst
    // exactly when their numbers differ: the stricter bucket's budget is
    // spent by traffic the looser one was sized for.
    const byName = new Map<string, BucketConfig>()

    for (const rule of await collectRules()) {
      const seen = byName.get(rule.name)
      if (seen !== undefined) expect(rule.bucket).toEqual(seen)
      byName.set(rule.name, rule.bucket)
    }
  })

  it('names every rule after a bucket that actually exists', async () => {
    // Keeps the namespace from drifting away from the configuration: a rule
    // named for a bucket that was since renamed still works, and is still
    // wrong - it just quietly stops describing what it limits.
    const known: string[] = Object.keys(RATE_LIMITS)

    for (const rule of await collectRules()) {
      expect(known).toContain(rule.name)
    }
  })
})
