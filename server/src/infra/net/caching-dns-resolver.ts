import type { DnsResolver } from '../../data/protocols/net/dns-resolver.js'

/**
 * One instance per audit, so the cache's lifetime is the audit's. That bounds
 * DNS rebinding to a window of milliseconds rather than the process's lifetime,
 * which is the tradeoff recorded in DECISIONS.md.
 */
export class CachingDnsResolver implements DnsResolver {
  private readonly inFlight = new Map<string, Promise<string[]>>()

  constructor (private readonly inner: DnsResolver) {}

  async resolve (hostname: string): Promise<string[]> {
    const cached = this.inFlight.get(hostname)
    if (cached !== undefined) return await cached

    // The PROMISE is cached, not the result: a page pulling twenty
    // subresources fires them together, and caching only on completion would
    // let all twenty miss and issue twenty identical lookups.
    const pending = this.inner.resolve(hostname).catch((error: unknown) => {
      // A rejection must not stay cached, or one transient outage blocks that
      // host for the rest of the audit.
      this.inFlight.delete(hostname)
      throw error
    })

    this.inFlight.set(hostname, pending)
    return await pending
  }
}
