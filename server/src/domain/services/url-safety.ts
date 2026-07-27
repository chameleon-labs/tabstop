import { BlockList, isIP } from 'node:net'

export type UrlRejection = 'invalid-url' | 'blocked-scheme' | 'blocked-port' | 'blocked-address'

export type UrlSafetyResult =
  | { safe: true, url: URL }
  | { safe: false, reason: UrlRejection }

const blocked = new BlockList()
blocked.addSubnet('0.0.0.0', 8)
blocked.addSubnet('10.0.0.0', 8)
blocked.addSubnet('127.0.0.0', 8)
blocked.addSubnet('169.254.0.0', 16)
blocked.addSubnet('172.16.0.0', 12)
blocked.addSubnet('192.168.0.0', 16)
blocked.addSubnet('::1', 128, 'ipv6')
blocked.addSubnet('fc00::', 7, 'ipv6')
blocked.addSubnet('fe80::', 10, 'ipv6')

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
export const parseAuditUrl = (raw: string): UrlSafetyResult => {
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
  if (port === undefined || !ALLOWED_PORTS.includes(port)) {
    return { safe: false, reason: 'blocked-port' }
  }

  // A literal address needs no DNS at all, and catching it here keeps the
  // most obvious attack out of the resolver path entirely.
  const host = bareHostname(url)
  if (isIP(host) !== 0 && isBlockedAddress(host)) {
    return { safe: false, reason: 'blocked-address' }
  }

  return { safe: true, url }
}
