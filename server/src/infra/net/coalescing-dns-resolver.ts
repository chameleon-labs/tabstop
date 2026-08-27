import type {DnsResolver} from '../../data/protocols/net/dns-resolver.js';

export class CoalescingDnsResolver implements DnsResolver {
  private readonly inFlight = new Map<string, Promise<string[]>>();

  constructor(private readonly inner: DnsResolver) {}

  async resolve(hostname: string): Promise<string[]> {
    const pending = this.inFlight.get(hostname);
    if (pending !== undefined) {
      return await pending;
    }

    const lookup = this.inner.resolve(hostname);
    this.inFlight.set(hostname, lookup);

    try {
      return await lookup;
    } finally {
      this.inFlight.delete(hostname);
    }
  }
}
