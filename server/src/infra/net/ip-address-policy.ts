import {BlockList, isIP} from 'node:net';
import {ALLOWED_PORTS, type UrlPolicy} from '../../domain/services/url-safety.js';

type BlockedRange = {name: string; address: string; prefix: number; family: 'ipv4' | 'ipv6'};

const BLOCKED_RANGES: readonly BlockedRange[] = [
  {name: 'this network', address: '0.0.0.0', prefix: 8, family: 'ipv4'},
  {name: 'private', address: '10.0.0.0', prefix: 8, family: 'ipv4'},
  {name: 'loopback', address: '127.0.0.0', prefix: 8, family: 'ipv4'},
  {name: 'link-local', address: '169.254.0.0', prefix: 16, family: 'ipv4'},
  {name: 'private', address: '172.16.0.0', prefix: 12, family: 'ipv4'},
  {name: 'private', address: '192.168.0.0', prefix: 16, family: 'ipv4'},
  {name: 'carrier-grade NAT', address: '100.64.0.0', prefix: 10, family: 'ipv4'},
  {name: 'IETF protocol assignments', address: '192.0.0.0', prefix: 24, family: 'ipv4'},
  {name: 'TEST-NET-1', address: '192.0.2.0', prefix: 24, family: 'ipv4'},
  {name: 'benchmarking', address: '198.18.0.0', prefix: 15, family: 'ipv4'},
  {name: 'TEST-NET-2', address: '198.51.100.0', prefix: 24, family: 'ipv4'},
  {name: 'TEST-NET-3', address: '203.0.113.0', prefix: 24, family: 'ipv4'},
  {name: 'multicast', address: '224.0.0.0', prefix: 4, family: 'ipv4'},
  {name: 'reserved, including the broadcast address', address: '240.0.0.0', prefix: 4, family: 'ipv4'},
  {name: 'IPv4-compatible, wrapping an IPv4 address', address: '::', prefix: 96, family: 'ipv6'},
  {name: 'unspecified, reaching a local listener', address: '::', prefix: 128, family: 'ipv6'},
  {name: 'loopback', address: '::1', prefix: 128, family: 'ipv6'},
  {name: 'unique local', address: 'fc00::', prefix: 7, family: 'ipv6'},
  {name: 'link-local', address: 'fe80::', prefix: 10, family: 'ipv6'},
  {name: 'site-local, deprecated but still routed on legacy networks', address: 'fec0::', prefix: 10, family: 'ipv6'},
  {name: 'multicast', address: 'ff00::', prefix: 8, family: 'ipv6'},
  {name: '6to4, wrapping an IPv4 address', address: '2002::', prefix: 16, family: 'ipv6'},
  {name: 'NAT64, wrapping an IPv4 address', address: '64:ff9b::', prefix: 96, family: 'ipv6'},
  {name: 'NAT64 local-use, wrapping an IPv4 address', address: '64:ff9b:1::', prefix: 48, family: 'ipv6'},
  {name: 'discard-only', address: '100::', prefix: 64, family: 'ipv6'},
  {name: 'Teredo, wrapping an IPv4 address', address: '2001::', prefix: 32, family: 'ipv6'},
  {name: 'benchmarking', address: '2001:2::', prefix: 48, family: 'ipv6'},
  {name: 'ORCHID, deprecated', address: '2001:10::', prefix: 28, family: 'ipv6'},
  {name: 'ORCHIDv2', address: '2001:20::', prefix: 28, family: 'ipv6'},
  {name: 'documentation', address: '2001:db8::', prefix: 32, family: 'ipv6'},
  {name: 'documentation', address: '3fff::', prefix: 20, family: 'ipv6'},
  {name: 'segment routing', address: '5f00::', prefix: 16, family: 'ipv6'},
];

const blocked = new BlockList();
for (const range of BLOCKED_RANGES) {
  blocked.addSubnet(range.address, range.prefix, range.family);
}

export const isBlockedAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 0) {
    return true;
  }
  return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
};

export const isIpLiteral = (host: string): boolean => isIP(host) !== 0;

export const DEFAULT_URL_POLICY: UrlPolicy = {
  isAllowedPort: (port) => ALLOWED_PORTS.includes(port),
  isBlockedAddress,
  isIpLiteral,
};
