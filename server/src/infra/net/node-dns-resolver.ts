import {lookup} from 'node:dns/promises';
import type {DnsResolver} from '../../data/protocols/net/dns-resolver.js';

export class NodeDnsResolver implements DnsResolver {
  async resolve(hostname: string): Promise<string[]> {
    try {
      const results = await lookup(hostname, {all: true, verbatim: true});
      return results.map((result) => result.address);
    } catch {
      return [];
    }
  }
}
