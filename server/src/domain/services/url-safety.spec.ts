import { describe, expect, it } from 'vitest'
import { isBlockedAddress, parseAuditUrl } from './url-safety.js'

describe('isBlockedAddress', () => {
  it('blocks every private and reserved range', () => {
    for (const address of [
      '0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.169.254',
      '172.16.5.5', '172.31.255.255', '192.168.1.1',
      '::1', 'fd00::1', 'fe80::1'
    ]) {
      expect(isBlockedAddress(address)).toBe(true)
    }
  })

  it('blocks the reserved ranges beyond the obvious private ones', () => {
    // Each of these was verified ALLOWED before being added, and each is
    // reachable: an unspecified address hits a local listener, and 6to4 and
    // NAT64 both embed an IPv4 address so a v6 literal can address 127.0.0.1
    // without ever looking like it.
    for (const address of [
      '::',                 // unspecified
      '100.64.0.1',         // carrier-grade NAT
      '192.0.0.1',          // IETF protocol assignments
      '198.18.0.1',         // benchmarking
      '224.0.0.1',          // multicast
      '240.0.0.1', '255.255.255.255',
      'ff02::1',            // v6 multicast
      '2002:7f00:1::',      // 6to4 wrapping 127.0.0.1
      '64:ff9b::7f00:1',    // NAT64 wrapping 127.0.0.1
      '64:ff9b:1::a00:1'    // RFC 8215 local-use NAT64 wrapping 10.0.0.1
    ]) {
      expect(isBlockedAddress(address)).toBe(true)
    }
  })

  it('allows ordinary public addresses', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) {
      expect(isBlockedAddress(address)).toBe(false)
    }
  })

  it('blocks the IPv4-mapped IPv6 form of a private address', () => {
    // ::ffff:127.0.0.1 is the classic way past a checker that only inspects
    // dotted-quad strings.
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true)
  })

  it('blocks anything that is not an address at all', () => {
    // node:net BlockList.check returns FALSE for a non-address, so relying on
    // it alone fails OPEN. Verified against Node 24.
    for (const value of ['', 'not-an-ip', 'localhost', '999.999.999.999', '10.1.2.3 ']) {
      expect(isBlockedAddress(value)).toBe(true)
    }
  })
})

describe('parseAuditUrl', () => {
  it('accepts an ordinary http and https URL', () => {
    expect(parseAuditUrl('https://example.com/a').safe).toBe(true)
    expect(parseAuditUrl('http://example.com').safe).toBe(true)
  })

  it('rejects a non-http scheme', () => {
    for (const raw of [
      'file:///etc/passwd', 'ftp://example.com', 'gopher://example.com',
      'javascript:alert(1)', 'data:text/html,<h1>x'
    ]) {
      expect(parseAuditUrl(raw)).toEqual({ safe: false, reason: 'blocked-scheme' })
    }
  })

  it('rejects a literal private address without any DNS lookup', () => {
    expect(parseAuditUrl('http://169.254.169.254/latest/meta-data/'))
      .toEqual({ safe: false, reason: 'blocked-address' })
    expect(parseAuditUrl('http://[::1]/')).toEqual({ safe: false, reason: 'blocked-address' })
    expect(parseAuditUrl('http://127.0.0.1/')).toEqual({ safe: false, reason: 'blocked-address' })
  })

  it('rejects a non-standard port', () => {
    expect(parseAuditUrl('http://example.com:8080/'))
      .toEqual({ safe: false, reason: 'blocked-port' })
    expect(parseAuditUrl('https://example.com:3000/'))
      .toEqual({ safe: false, reason: 'blocked-port' })
  })

  it('accepts the default ports, stated explicitly or not', () => {
    expect(parseAuditUrl('http://example.com:80/').safe).toBe(true)
    expect(parseAuditUrl('https://example.com:443/').safe).toBe(true)
  })

  it('rejects unparseable input rather than throwing', () => {
    for (const raw of ['', 'not a url', 'http://', '://example.com']) {
      expect(parseAuditUrl(raw)).toEqual({ safe: false, reason: 'invalid-url' })
    }
  })

  it('normalises the host but not the path', () => {
    const result = parseAuditUrl('HTTPS://Example.COM/Path')

    expect(result.safe && result.url.host).toBe('example.com')
    // Path case is significant to a server, so folding it would audit a
    // different page than the one asked for.
    expect(result.safe && result.url.pathname).toBe('/Path')
  })
})
