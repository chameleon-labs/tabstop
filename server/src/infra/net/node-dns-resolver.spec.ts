import {describe, expect, it} from 'vitest';
import {isIP} from 'node:net';
import {NodeDnsResolver} from './node-dns-resolver.js';

describe('NodeDnsResolver', () => {
  const sut = new NodeDnsResolver();

  it('resolves localhost to a loopback address', async () => {
    const addresses = await sut.resolve('localhost');

    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.some((address) => address === '127.0.0.1' || address === '::1')).toBe(true);
  });

  it('returns addresses that actually parse as addresses', async () => {
    const addresses = await sut.resolve('localhost');

    expect(addresses.every((address) => isIP(address) !== 0)).toBe(true);
  });

  it('returns an empty list rather than throwing for a name that does not exist', async () => {
    expect(await sut.resolve('nx-does-not-exist.invalid')).toEqual([]);
  });
});
