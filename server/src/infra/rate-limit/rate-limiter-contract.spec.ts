import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MemoryTokenBucket } from './memory-token-bucket.js'
import { RedisTokenBucket } from './redis-token-bucket.js'
import type {
  BucketConfig, RateLimiter
} from '../../data/protocols/rate-limit/rate-limiter.js'

const frozen: BucketConfig = { capacity: 3, refillPerHour: 1 }
const fast: BucketConfig = { capacity: 3, refillPerHour: 36_000 }

let redis: Redis

beforeAll(() => {
  const url = process.env.REDIS_URL
  if (url === undefined) throw new Error('REDIS_URL not set by globalSetup')
  redis = new Redis(url)
})

afterAll(async () => { await redis.quit() })

/**
 * One table, both implementations. The decorator swaps between them during a
 * Redis outage, so a behavioural difference would show up as the limits
 * quietly changing shape at the worst possible moment.
 *
 * The factories are called inside each spec rather than at describe time,
 * because `redis` is only assigned in beforeAll.
 */
describe.each<[string, () => RateLimiter]>([
  ['RedisTokenBucket', () => new RedisTokenBucket(redis)],
  ['MemoryTokenBucket', () => new MemoryTokenBucket()]
])('%s as a RateLimiter', (_name, make) => {
  const key = (): string => `contract-${randomUUID()}`

  it('allows exactly the capacity from cold, then rejects', async () => {
    const sut = make()
    const k = key()

    const results = []
    for (let i = 0; i < 4; i++) results.push(await sut.consume(k, frozen))

    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false])
  })

  it('counts down the remaining tokens', async () => {
    const sut = make()
    const k = key()

    const first = await sut.consume(k, frozen)
    const second = await sut.consume(k, frozen)

    expect(first).toEqual({ allowed: true, remaining: 2 })
    expect(second).toEqual({ allowed: true, remaining: 1 })
  })

  it('reports a wait scaled to the deficit rather than a constant', async () => {
    const sut = make()
    const k = key()
    for (let i = 0; i < 3; i++) await sut.consume(k, frozen)

    const denied = await sut.consume(k, frozen)

    if (denied.allowed) throw new Error('expected the bucket to be empty')
    // One token per hour, so one token of deficit is most of an hour.
    expect(denied.retryAfterMs).toBeGreaterThan(3_000_000)
    expect(denied.retryAfterMs).toBeLessThanOrEqual(3_600_000)
  })

  it('refills over elapsed time', async () => {
    const sut = make()
    const k = key()
    for (let i = 0; i < 3; i++) await sut.consume(k, fast)
    expect((await sut.consume(k, fast)).allowed).toBe(false)

    await new Promise((resolve) => setTimeout(resolve, 250))

    expect((await sut.consume(k, fast)).allowed).toBe(true)
  })

  it('keeps buckets separate per key', async () => {
    const sut = make()
    const exhausted = key()
    for (let i = 0; i < 3; i++) await sut.consume(exhausted, frozen)

    expect((await sut.consume(key(), frozen)).allowed).toBe(true)
  })

  it('returns a token on refund', async () => {
    const sut = make()
    const k = key()
    for (let i = 0; i < 3; i++) await sut.consume(k, frozen)

    await sut.refund(k, frozen)

    expect((await sut.consume(k, frozen)).allowed).toBe(true)
  })

  it('cannot refund a full bucket past its capacity', async () => {
    const sut = make()
    const k = key()
    for (let i = 0; i < 5; i++) await sut.refund(k, frozen)

    const results = []
    for (let i = 0; i < 4; i++) results.push(await sut.consume(k, frozen))

    expect(results.filter((result) => result.allowed)).toHaveLength(3)
  })
})
