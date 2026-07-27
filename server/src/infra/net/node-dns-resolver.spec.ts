import { describe, expect, it } from 'vitest'
import { isIP } from 'node:net'
import { NodeDnsResolver } from './node-dns-resolver.js'

describe('NodeDnsResolver', () => {
  const sut = new NodeDnsResolver()

  it('resolves localhost to a loopback address', async () => {
    // Offline and stable, and it is exactly the address the blocklist most
    // needs to see coming back from a name.
    const addresses = await sut.resolve('localhost')

    expect(addresses.length).toBeGreaterThan(0)
    expect(addresses.some((address) => address === '127.0.0.1' || address === '::1')).toBe(true)
  })

  it('returns addresses that actually parse as addresses', async () => {
    const addresses = await sut.resolve('localhost')

    expect(addresses.every((address) => isIP(address) !== 0)).toBe(true)
  })

  it('returns an empty list rather than throwing for a name that does not exist', async () => {
    // The guard treats empty as blocked, so a resolution failure fails closed
    // instead of escaping as an error.
    expect(await sut.resolve('nx-does-not-exist.invalid')).toEqual([])
  })
})
