import {describe, expect, it} from 'vitest';
import {parseAuditUrl} from '../../domain/services/url-safety.js';
import {DEFAULT_URL_POLICY, isBlockedAddress} from './ip-address-policy.js';

describe('isBlockedAddress', () => {
  it('blocks every private and reserved range', () => {
    for (const address of [
      '0.0.0.0',
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.5.5',
      '172.31.255.255',
      '192.168.1.1',
      '::1',
      'fd00::1',
      'fe80::1',
    ]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
  });

  it.each([
    {name: 'the unspecified address, reaching a local listener', address: '::'},
    {name: 'carrier-grade NAT', address: '100.64.0.1'},
    {name: 'IETF protocol assignments', address: '192.0.0.1'},
    {name: 'benchmarking', address: '198.18.0.1'},
    {name: 'multicast', address: '224.0.0.1'},
    {name: 'reserved space', address: '240.0.0.1'},
    {name: 'the broadcast address', address: '255.255.255.255'},
    {name: 'site-local, deprecated but still routed on legacy networks', address: 'fec0::1'},
    {name: 'v6 multicast', address: 'ff02::1'},
    {name: '6to4 wrapping 127.0.0.1', address: '2002:7f00:1::'},
    {name: 'NAT64 wrapping 127.0.0.1', address: '64:ff9b::7f00:1'},
    {name: 'RFC 8215 local-use NAT64 wrapping 10.0.0.1', address: '64:ff9b:1::a00:1'},
    {name: 'discard-only', address: '100::1'},
    {name: 'Teredo, wrapping an IPv4 address like 6to4', address: '2001::1'},
    {name: 'benchmarking', address: '2001:2::1'},
    {name: 'ORCHID, deprecated', address: '2001:10::1'},
    {name: 'ORCHIDv2', address: '2001:20::1'},
    {name: 'documentation', address: '2001:db8::1'},
    {name: 'documentation', address: '3fff::1'},
    {name: 'segment routing', address: '5f00::1'},
  ])('blocks $address, which is $name', ({address}) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it('allows ordinary public addresses', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) {
      expect(isBlockedAddress(address)).toBe(false);
    }
  });

  it('blocks the IPv4-mapped IPv6 form of a private address', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true);
  });

  it('blocks the IPv4-COMPATIBLE IPv6 form too, not only the mapped one', () => {
    expect(isBlockedAddress('::127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::169.254.169.254')).toBe(true);
    expect(isBlockedAddress('::10.0.0.1')).toBe(true);
    expect(isBlockedAddress('::7f00:1')).toBe(true);
  });

  it('still allows a public address in IPv4-mapped form', () => {
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('blocks anything that is not an address at all', () => {
    for (const value of ['', 'not-an-ip', 'localhost', '999.999.999.999', '10.1.2.3 ']) {
      expect(isBlockedAddress(value)).toBe(true);
    }
  });
});

describe('parseAuditUrl', () => {
  it('accepts an ordinary http and https URL', () => {
    expect(parseAuditUrl('https://example.com/a', DEFAULT_URL_POLICY).safe).toBe(true);
    expect(parseAuditUrl('http://example.com', DEFAULT_URL_POLICY).safe).toBe(true);
  });

  it('rejects a non-http scheme', () => {
    for (const raw of [
      'file:///etc/passwd',
      'ftp://example.com',
      'gopher://example.com',
      // oxlint-disable-next-line no-script-url -- the blocked scheme under test
      'javascript:alert(1)',
      'data:text/html,<h1>x',
    ]) {
      expect(parseAuditUrl(raw, DEFAULT_URL_POLICY)).toEqual({safe: false, reason: 'blocked-scheme'});
    }
  });

  it('rejects a literal private address without any DNS lookup', () => {
    expect(parseAuditUrl('http://169.254.169.254/latest/meta-data/', DEFAULT_URL_POLICY)).toEqual({
      safe: false,
      reason: 'blocked-address',
    });
    expect(parseAuditUrl('http://[::1]/', DEFAULT_URL_POLICY)).toEqual({safe: false, reason: 'blocked-address'});
    expect(parseAuditUrl('http://127.0.0.1/', DEFAULT_URL_POLICY)).toEqual({safe: false, reason: 'blocked-address'});
    expect(parseAuditUrl('http://[::169.254.169.254]/latest/meta-data/', DEFAULT_URL_POLICY)).toEqual({
      safe: false,
      reason: 'blocked-address',
    });
    expect(parseAuditUrl('http://[::127.0.0.1]/', DEFAULT_URL_POLICY)).toEqual({
      safe: false,
      reason: 'blocked-address',
    });
  });

  it('rejects a URL carrying credentials', () => {
    for (const raw of [
      'https://alice:secret@example.com/',
      'https://alice@example.com/',
      'http://:secret@example.com/',
    ]) {
      expect(parseAuditUrl(raw, DEFAULT_URL_POLICY)).toEqual({safe: false, reason: 'blocked-credentials'});
    }
  });

  it('rejects a non-standard port', () => {
    expect(parseAuditUrl('http://example.com:8080/', DEFAULT_URL_POLICY)).toEqual({
      safe: false,
      reason: 'blocked-port',
    });
    expect(parseAuditUrl('https://example.com:3000/', DEFAULT_URL_POLICY)).toEqual({
      safe: false,
      reason: 'blocked-port',
    });
  });

  it('accepts the default ports, stated explicitly or not', () => {
    expect(parseAuditUrl('http://example.com:80/', DEFAULT_URL_POLICY).safe).toBe(true);
    expect(parseAuditUrl('https://example.com:443/', DEFAULT_URL_POLICY).safe).toBe(true);
  });

  it('rejects unparseable input rather than throwing', () => {
    for (const raw of ['', 'not a url', 'http://', '://example.com']) {
      expect(parseAuditUrl(raw, DEFAULT_URL_POLICY)).toEqual({safe: false, reason: 'invalid-url'});
    }
  });

  it('normalises the host but not the path', () => {
    const result = parseAuditUrl('HTTPS://Example.COM/Path', DEFAULT_URL_POLICY);

    expect(result.safe && result.url.host).toBe('example.com');
    expect(result.safe && result.url.pathname).toBe('/Path');
  });
});
