import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RedisTokenBucket } from './redis-token-bucket.js'
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

  it('allows exactly the capacity from cold, then rejects', async () => {
    const k = key()

    const first = await sut.consume(k, frozen)
    const second = await sut.consume(k, frozen)
    const third = await sut.consume(k, frozen)
    const fourth = await sut.consume(k, frozen)

    expect(first).toEqual({ allowed: true, remaining: 2 })
    expect(second).toEqual({ allowed: true, remaining: 1 })
    expect(third).toEqual({ allowed: true, remaining: 0 })
    expect(fourth.allowed).toBe(false)
  })

  it('reports how long the caller must wait, scaled to the deficit', async () => {
    const k = key()
    for (let i = 0; i < 3; i++) await sut.consume(k, frozen)

    const denied = await sut.consume(k, frozen)

    if (denied.allowed) throw new Error('expected the bucket to be empty')
    // One token per hour, so a deficit of one token is close to an hour. A
    // constant would satisfy `> 0`; this pins that the number means something.
    expect(denied.retryAfterMs).toBeGreaterThan(3_000_000)
    expect(denied.retryAfterMs).toBeLessThanOrEqual(3_600_000)
  })

  it('refills over elapsed time', async () => {
    const k = key()
    for (let i = 0; i < 3; i++) await sut.consume(k, fast)
    expect((await sut.consume(k, fast)).allowed).toBe(false)

    await new Promise((resolve) => setTimeout(resolve, 250))

    expect((await sut.consume(k, fast)).allowed).toBe(true)
  })

  it('never oversells under concurrency', async () => {
    // The reason the whole thing is one Lua script. A read-then-write from
    // Node lets two callers both see the last token and both proceed.
    const k = key()

    const results = await Promise.all(
      Array.from({ length: 20 }, async () => await sut.consume(k, frozen))
    )

    expect(results.filter((result) => result.allowed)).toHaveLength(3)
  })

  it('returns a token on refund', async () => {
    const k = key()
    for (let i = 0; i < 3; i++) await sut.consume(k, frozen)

    await sut.refund(k, frozen)

    expect((await sut.consume(k, frozen)).allowed).toBe(true)
  })

  it('cannot refund a full bucket past its capacity', async () => {
    // Otherwise refund becomes a way to mint quota.
    const k = key()
    for (let i = 0; i < 5; i++) await sut.refund(k, frozen)

    const results = []
    for (let i = 0; i < 4; i++) results.push(await sut.consume(k, frozen))

    expect(results.filter((result) => result.allowed)).toHaveLength(3)
  })

  it('does not let a single refund on a full bucket blow past its TTL budget', async () => {
    // The previous spec only observes an over-refund through a later consume,
    // and that goes through the refill step's own cap first - which quietly
    // re-clamps the excess before a consume ever sees it. But an uncapped
    // refund on a full bucket leaves `tokens` above `capacity`, so
    // `capacity - tokens` goes negative; PEXPIRE with a negative value
    // deletes the key outright, rather than setting a small TTL. That
    // deletion - visible via PTTL, the same channel the TTL spec below uses
    // - is the externally observable symptom of the cap being missing.
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
})
