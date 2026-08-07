import {lookup} from 'node:dns/promises';
import type {DnsResolver} from '../../data/protocols/net/dns-resolver.js';

export class NodeDnsResolver implements DnsResolver {
  async resolve(hostname: string): Promise<string[]> {
    try {
      const results = await lookup(hostname, {all: true, verbatim: true});
      return results.map((result) => result.address);
    } catch {
      // Fail closed. The guard blocks an empty result, so a name that cannot
      // be resolved is refused rather than escaping as an error the caller
      // might mistake for something else.
      return [];
    }
  }
}
