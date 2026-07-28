import { describe, expect, it } from 'vitest'
import { MemoryTokenBucket } from './memory-token-bucket.js'
import type { BucketConfig } from '../../data/protocols/rate-limit/rate-limiter.js'

const frozen: BucketConfig = { capacity: 3, refillPerHour: 1 }

describe('MemoryTokenBucket', () => {
  it('caps a refund at capacity even when the next read uses a wider bucket', async () => {
    // `refilled` re-clamps to `bucket.capacity` on every read, so a same-config
    // round trip can never observe an uncapped store: the clamp on read hides
    // a missing clamp on write. Only a capacity change between the refund and
    // the following read exposes it. (Redis has the same defect shape but a
    // different, already-observable side effect - an uncapped value pushes its
    // PEXPIRE negative, deleting the key outright.)
    const sut = new MemoryTokenBucket()
    const wide: BucketConfig = { capacity: 10, refillPerHour: 1 }

    await sut.refund('a', frozen) // a cold bucket is already full

    expect(await sut.consume('a', wide)).toEqual({ allowed: true, remaining: 2 })
  })

  it('evicts rather than growing without bound', async () => {
    // An unbounded map would make the fallback a memory-exhaustion vector
    // during exactly the outage it exists to survive.
    const sut = new MemoryTokenBucket(2)

    await sut.consume('a', frozen)
    await sut.consume('b', frozen)
    await sut.consume('c', frozen)

    expect(sut.size).toBe(2)
  })

  it('evicts the least recently used key', async () => {
    const sut = new MemoryTokenBucket(2)
    for (let i = 0; i < 3; i++) await sut.consume('a', frozen)
    await sut.consume('b', frozen)
    // Touching 'a' makes 'b' the least recently used.
    await sut.consume('a', frozen)

    await sut.consume('c', frozen)

    // 'a' survived, so it is still exhausted; 'b' was evicted and is fresh.
    expect((await sut.consume('a', frozen)).allowed).toBe(false)
    expect((await sut.consume('b', frozen)).allowed).toBe(true)
  })
})
