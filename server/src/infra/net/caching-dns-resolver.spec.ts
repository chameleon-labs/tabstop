import { describe, expect, it, vi } from 'vitest'
import { CachingDnsResolver } from './caching-dns-resolver.js'
import type { DnsResolver } from '../../data/protocols/net/dns-resolver.js'

const mockResolver = (impl: DnsResolver['resolve']) => ({ resolve: vi.fn(impl) })

describe('CachingDnsResolver', () => {
  it('resolves each hostname once', async () => {
    const inner = mockResolver(async () => ['93.184.216.34'])
    const sut = new CachingDnsResolver(inner)

    await sut.resolve('example.com')
    await sut.resolve('example.com')
    await sut.resolve('other.test')

    expect(inner.resolve).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent lookups of the same host', async () => {
    // A page pulls its subresources all at once; caching only on completion
    // would let every one of them miss together.
    const inner = mockResolver(async () => ['93.184.216.34'])
    const sut = new CachingDnsResolver(inner)

    await Promise.all([
      sut.resolve('example.com'), sut.resolve('example.com'), sut.resolve('example.com')
    ])

    expect(inner.resolve).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failure, so a transient outage is not sticky', async () => {
    const inner = mockResolver(async () => { throw new Error('EAI_AGAIN') })
    const sut = new CachingDnsResolver(inner)

    await expect(sut.resolve('example.com')).rejects.toThrow()
    await expect(sut.resolve('example.com')).rejects.toThrow()

    expect(inner.resolve).toHaveBeenCalledTimes(2)
  })

  it('returns the inner resolver result unchanged', async () => {
    const sut = new CachingDnsResolver(mockResolver(async () => ['10.0.0.5', '93.184.216.34']))

    expect(await sut.resolve('mixed.test')).toEqual(['10.0.0.5', '93.184.216.34'])
  })
})
