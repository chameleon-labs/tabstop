import type {DnsResolver} from '../../data/protocols/net/dns-resolver.js';

/**
 * Coalesces lookups that are in flight together, and nothing more.
 *
 * It deliberately does NOT cache a completed result. Holding one would mean
 * validating an address once and then trusting it for the rest of an audit
 * that can run for tens of seconds - long enough for an attacker to answer
 * publicly, flip DNS, and have a later request approved against the stale
 * public answer while Chromium resolves the private one. Evicting on
 * settlement keeps the gap between "checked" and "fetched" to a single
 * request, which is the bound DECISIONS.md claims.
 *
 * The saving that remains is the one worth having: a page pulling twenty
 * subresources from five hosts fires them together, and those still share
 * five lookups rather than issuing twenty.
 */
export class CoalescingDnsResolver implements DnsResolver {
  private readonly inFlight = new Map<string, Promise<string[]>>();

  constructor(private readonly inner: DnsResolver) {}

  async resolve(hostname: string): Promise<string[]> {
    const pending = this.inFlight.get(hostname);
    if (pending !== undefined) return await pending;

    const lookup = this.inner.resolve(hostname);
    this.inFlight.set(hostname, lookup);

    try {
      return await lookup;
    } finally {
      // On success as well as failure: a resolved answer must not outlive the
      // request that needed it.
      this.inFlight.delete(hostname);
    }
  }
}
