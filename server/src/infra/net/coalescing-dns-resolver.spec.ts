import { describe, expect, it, vi } from 'vitest'
import { CoalescingDnsResolver } from './coalescing-dns-resolver.js'
import type { DnsResolver } from '../../data/protocols/net/dns-resolver.js'

const mockResolver = (impl: DnsResolver['resolve']) => ({ resolve: vi.fn(impl) })

const deferred = () => {
  let release: (value: string[]) => void = () => { /* replaced below */ }
  const promise = new Promise<string[]>((resolve) => { release = resolve })
  return { promise, release }
}

describe('CoalescingDnsResolver', () => {
  it('shares one lookup between concurrent callers', async () => {
    const inner = mockResolver(async () => ['93.184.216.34'])
    const sut = new CoalescingDnsResolver(inner)

    await Promise.all([
      sut.resolve('example.com'), sut.resolve('example.com'), sut.resolve('example.com')
    ])

    expect(inner.resolve).toHaveBeenCalledTimes(1)
  })

  it('does NOT reuse a completed answer for a later request', async () => {
    // The regression this pins: holding a resolved answer means validating an
    // address once and trusting it for the rest of an audit that can run for
    // tens of seconds - long enough to answer publicly, flip DNS, and have a
    // later request approved against the stale public answer while the browser
    // resolves the private one.
    const inner = mockResolver(async () => ['93.184.216.34'])
    const sut = new CoalescingDnsResolver(inner)

    await sut.resolve('example.com')
    await sut.resolve('example.com')

    expect(inner.resolve).toHaveBeenCalledTimes(2)
  })

  it('sees the answer change when DNS changes underneath it', async () => {
    let answer = ['93.184.216.34']
    const sut = new CoalescingDnsResolver(mockResolver(async () => answer))

    expect(await sut.resolve('example.com')).toEqual(['93.184.216.34'])
    answer = ['10.0.0.5']
    expect(await sut.resolve('example.com')).toEqual(['10.0.0.5'])
  })

  it('coalesces only while the lookup is genuinely in flight', async () => {
    const gate = deferred()
    const inner = mockResolver(async () => await gate.promise)
    const sut = new CoalescingDnsResolver(inner)

    const first = sut.resolve('example.com')
    const second = sut.resolve('example.com')
    gate.release(['93.184.216.34'])
    await Promise.all([first, second])

    expect(inner.resolve).toHaveBeenCalledTimes(1)

    await sut.resolve('example.com')
    expect(inner.resolve).toHaveBeenCalledTimes(2)
  })

  it('does not leave a failure wedged in the map', async () => {
    const inner = mockResolver(async () => { throw new Error('EAI_AGAIN') })
    const sut = new CoalescingDnsResolver(inner)

    await expect(sut.resolve('example.com')).rejects.toThrow()
    await expect(sut.resolve('example.com')).rejects.toThrow()

    expect(inner.resolve).toHaveBeenCalledTimes(2)
  })
})
