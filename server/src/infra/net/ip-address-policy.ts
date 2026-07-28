import { BlockList, isIP } from 'node:net'
import { ALLOWED_PORTS, type UrlPolicy } from '../../domain/services/url-safety.js'

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

/**
 * The IPv4-COMPATIBLE range, `::a.b.c.d`, and the whole of it rather than just
 * `::` as a /128.
 *
 * It is the sibling of the IPv4-mapped form below and needs its own rule: node
 * reads `::ffff:0:0/96` against the IPv4 subnets above, but `::/96` is a
 * different prefix and matched nothing, so `::169.254.169.254` was ALLOWED -
 * the same wrapped-IPv4 trick as 6to4 and NAT64, both of which this list
 * already refuses on exactly that reasoning.
 *
 * Measured as unroutable on Linux and macOS alike (ENETUNREACH / EHOSTUNREACH),
 * so this closes a gap rather than a live bypass. That is the same standard
 * applied to fec0::/10 below, which is blocked for being routable on legacy
 * networks rather than on ours.
 *
 * This covers `::` and `::1` as a side effect, but both are stated below
 * anyway: they are blocked for their own reasons, and a later narrowing of
 * this range must not silently unblock them.
 */
blocked.addSubnet('::', 96, 'ipv6')
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
// The rest of IANA's non-global IPv6 space. Not globally routable, which is
// exactly why they are reachable inside an operator's network - and Teredo,
// like 6to4, embeds an IPv4 address, so it can name a private host outright.
blocked.addSubnet('100::', 64, 'ipv6')      // discard-only
blocked.addSubnet('2001::', 32, 'ipv6')     // Teredo, embeds IPv4
blocked.addSubnet('2001:2::', 48, 'ipv6')   // benchmarking
blocked.addSubnet('2001:10::', 28, 'ipv6')  // ORCHID, deprecated
blocked.addSubnet('2001:20::', 28, 'ipv6')  // ORCHIDv2
blocked.addSubnet('2001:db8::', 32, 'ipv6') // documentation
blocked.addSubnet('3fff::', 20, 'ipv6')     // documentation
blocked.addSubnet('5f00::', 16, 'ipv6')     // segment routing

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

/** Whether a hostname is already an address, so no lookup can change it. */
export const isIpLiteral = (host: string): boolean => isIP(host) !== 0

/**
 * The real policy, assembled here because two of its three rules need node's
 * network stack - which is precisely what domain/ must not import.
 *
 * The ranges live beside the matcher rather than as data in domain/ on
 * purpose: separating them would mean re-implementing subnet matching to
 * consume the list, and hand-rolled CIDR arithmetic is the single most common
 * home for this class of bug. The replaceable unit is the whole UrlPolicy.
 */
export const DEFAULT_URL_POLICY: UrlPolicy = {
  isAllowedPort: (port) => ALLOWED_PORTS.includes(port),
  isBlockedAddress,
  isIpLiteral
}
