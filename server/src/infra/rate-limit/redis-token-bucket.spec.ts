import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RedisTokenBucket, WAIT_MS_FORMULA } from './redis-token-bucket.js'
import type { BucketConfig } from '../../data/protocols/rate-limit/rate-limiter.js'

const connectionUrl = (): string => {
  const url = process.env.REDIS_URL
  if (url === undefined) throw new Error('REDIS_URL not set by globalSetup')
  return url
}

/** One token per 100ms, so refill is observable without a slow spec. */
const fast: BucketConfig = { capacity: 3, refillPerHour: 36_000 }
/** Effectively no refill, so burst behaviour can be asserted without a race. */
const frozen: BucketConfig = { capacity: 3, refillPerHour: 1 }

describe('RedisTokenBucket', () => {
  let redis: Redis
  let sut: RedisTokenBucket

  beforeAll(() => {
    redis = new Redis(connectionUrl())
    sut = new RedisTokenBucket(redis)
  })

  afterAll(async () => { await redis.quit() })

  const key = (): string => `spec-${randomUUID()}`

  it('never oversells under concurrency', async () => {
    // The reason the whole thing is one Lua script. A read-then-write from
    // Node lets two callers both see the last token and both proceed.
    const k = key()

    const results = await Promise.all(
      Array.from({ length: 20 }, async () => await sut.consume(k, frozen))
    )

    expect(results.filter((result) => result.allowed)).toHaveLength(3)
  })

  it('does not let a single refund on a full bucket blow past its TTL budget', async () => {
    // The contract spec `cannot refund a full bucket past its capacity` only
    // observes an over-refund through a later consume, and that goes through
    // the refill step's own cap first - which quietly re-clamps the excess
    // before a consume ever sees it. But an uncapped refund on a full bucket
    // leaves `tokens` above `capacity`, so `capacity - tokens` goes negative;
    // PEXPIRE with a negative value deletes the key outright, rather than
    // setting a small TTL. That deletion - visible via PTTL, the same channel
    // the TTL spec below uses - is the externally observable symptom of the
    // cap being missing, and it is Redis-specific: memory has no TTL to leak
    // through, which is why its own version of this defect needed a different
    // probe (see `caps a refund at capacity...` in memory-token-bucket.spec).
    const k = key()
    await sut.refund(k, frozen) // a cold bucket is already full

    const ttl = await redis.pttl(`rl:${k}`)

    expect(ttl).toBeGreaterThan(0) // the mutation deletes the key, so pttl is -2
    expect(ttl).toBeLessThanOrEqual(1_100)
  })

  it('expires an idle bucket rather than keeping a key per caller forever', async () => {
    const k = key()
    await sut.consume(k, fast)

    const ttl = await redis.pttl(`rl:${k}`)

    expect(ttl).toBeGreaterThan(0)
    // Time to refill what was taken, plus a second of grace.
    expect(ttl).toBeLessThanOrEqual(1_100)
  })

  it('does not overshoot the wait by a millisecond at an exact-boundary deficit', async () => {
    // A real consume() can't drive this deterministically: forcing SCRIPT's
    // own `tokens` to land at precisely `cost - 1` (a deficit of exactly one
    // token) would mean racing Redis's TIME() call, and a timing-dependent
    // spec is not evidence either way - it would pass or fail depending on
    // machine speed and load, not on whether the formula is correct. So this
    // evals WAIT_MS_FORMULA directly, against a real Lua interpreter, with
    // the exact inputs (deficit of 1, refillPerHour 1) that overshoot with
    // the naive `(cost - tokens) / refillPerMs` form: 3_600_001 instead of
    // 3_600_000. Sharing the formula string with the production script is
    // what keeps this from silently drifting out of sync with it.
    const script = `
      local cost = tonumber(ARGV[1])
      local tokens = tonumber(ARGV[2])
      local refillPerHour = tonumber(ARGV[3])
      local msPerHour = tonumber(ARGV[4])
      -- Defined so the formula string works whichever form it's in - the
      -- naive pre-fix version divides by this instead of multiplying by
      -- msPerHour directly.
      local refillPerMs = refillPerHour / msPerHour
      return math.ceil(${WAIT_MS_FORMULA})
    `

    const result = await redis.eval(script, 0, 1, 0, 1, 3_600_000)

    expect(Number(result)).toBe(3_600_000)
  })
})
