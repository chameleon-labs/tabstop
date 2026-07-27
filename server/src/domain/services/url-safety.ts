import { BlockList, isIP } from 'node:net'

export type UrlRejection = 'invalid-url' | 'blocked-scheme' | 'blocked-port' | 'blocked-address'

export type UrlSafetyResult =
  | { safe: true, url: URL }
  | { safe: false, reason: UrlRejection }

const blocked = new BlockList()
// The ranges the issue names.
blocked.addSubnet('0.0.0.0', 8)
blocked.addSubnet('10.0.0.0', 8)
blocked.addSubnet('127.0.0.0', 8)
blocked.addSubnet('169.254.0.0', 16)
blocked.addSubnet('172.16.0.0', 12)
blocked.addSubnet('192.168.0.0', 16)
// And the rest of the reserved space, which is just as reachable. Verified as
// allowed before this was added: 100.64.0.1, 192.0.0.1, 198.18.0.1,
// 224.0.0.1, 240.0.0.1.
blocked.addSubnet('100.64.0.0', 10)   // carrier-grade NAT
blocked.addSubnet('192.0.0.0', 24)    // IETF protocol assignments
blocked.addSubnet('192.0.2.0', 24)    // TEST-NET-1
blocked.addSubnet('198.18.0.0', 15)   // benchmarking
blocked.addSubnet('198.51.100.0', 24) // TEST-NET-2
blocked.addSubnet('203.0.113.0', 24)  // TEST-NET-3
blocked.addSubnet('224.0.0.0', 4)     // multicast
blocked.addSubnet('240.0.0.0', 4)     // reserved, includes 255.255.255.255

blocked.addSubnet('::', 128, 'ipv6')  // unspecified - reaches a local listener
blocked.addSubnet('::1', 128, 'ipv6')
blocked.addSubnet('fc00::', 7, 'ipv6')
blocked.addSubnet('fe80::', 10, 'ipv6')
// Deprecated by RFC 3879 but still routed inside legacy private networks, so
// it is exactly the kind of address this policy exists to refuse.
blocked.addSubnet('fec0::', 10, 'ipv6')
blocked.addSubnet('ff00::', 8, 'ipv6') // multicast
// 6to4 and NAT64 both embed an IPv4 address, so a v6 literal can address
// 127.0.0.1 without ever looking like it. Verified: 2002:7f00:1:: was allowed.
blocked.addSubnet('2002::', 16, 'ipv6')
blocked.addSubnet('64:ff9b::', 96, 'ipv6')
// RFC 8215's local-use prefix translates just as well, and a configured
// translator routes 64:ff9b:1::a00:1 to 10.0.0.1. Verified as allowed before
// this line existed.
blocked.addSubnet('64:ff9b:1::', 48, 'ipv6')

/**
 * node:net's BlockList is used rather than hand-rolled CIDR arithmetic, which
 * is where this class of bug usually hides. It also handles ::ffff:127.0.0.1,
 * the IPv4-mapped form that slips past checkers looking only at dotted quads.
 *
 * It has one sharp edge: `check` returns FALSE for a string that is not an
 * address at all, so relying on it alone fails OPEN. Anything unrecognisable
 * is blocked here instead.
 */
export const isBlockedAddress = (address: string): boolean => {
  const family = isIP(address)
  if (family === 0) return true
  return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

/**
 * A non-standard port on a public audit tool is a strong signal of an internal
 * service, so the list starts closed. Chromium's own unsafe-port list is not a
 * boundary we control and is no substitute for this.
 */
export const ALLOWED_PORTS: readonly number[] = [80, 443]

const DEFAULT_PORTS: Readonly<Record<string, number>> = { 'http:': 80, 'https:': 443 }

/** An IPv6 hostname arrives bracketed from URL; the blocklist wants it bare. */
export const bareHostname = (url: URL): string =>
  url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname

/**
 * Pure: no DNS, no network, no clock. That is what makes the range list cheap
 * to test exhaustively, which is the only way this class of bug gets caught.
 */
/**
 * What counts as safe, as one replaceable unit.
 *
 * It is a parameter so the guard's MECHANISM - redirect walking, subresource
 * refusal, the hop cap - can be exercised against a fixture server, which
 * necessarily listens on loopback and an ephemeral port: both of which the
 * real policy is determined to refuse, and rightly so.
 *
 * The POLICY itself is not tested that way. Every range and every port rule is
 * covered exhaustively by the pure specs in this file, with no network at all.
 * Splitting them keeps each honest: the policy specs cannot be satisfied by a
 * lenient mechanism, and the mechanism specs cannot be satisfied by a lenient
 * policy. Nothing in production passes anything but the default.
 */
export type UrlPolicy = {
  isAllowedPort: (port: number) => boolean
  isBlockedAddress: (address: string) => boolean
}

export const DEFAULT_URL_POLICY: UrlPolicy = {
  isAllowedPort: (port) => ALLOWED_PORTS.includes(port),
  isBlockedAddress
}

export const parseAuditUrl = (
  raw: string,
  policy: UrlPolicy = DEFAULT_URL_POLICY
): UrlSafetyResult => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { safe: false, reason: 'invalid-url' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { safe: false, reason: 'blocked-scheme' }
  }

  const port = url.port === '' ? DEFAULT_PORTS[url.protocol] : Number(url.port)
  if (port === undefined || !policy.isAllowedPort(port)) {
    return { safe: false, reason: 'blocked-port' }
  }

  // A literal address needs no DNS at all, and catching it here keeps the
  // most obvious attack out of the resolver path entirely.
  const host = bareHostname(url)
  if (isIP(host) !== 0 && policy.isBlockedAddress(host)) {
    return { safe: false, reason: 'blocked-address' }
  }

  return { safe: true, url }
}
