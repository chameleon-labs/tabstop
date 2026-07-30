export type UrlRejection =
  | 'invalid-url' | 'blocked-scheme' | 'blocked-port' | 'blocked-address' | 'blocked-credentials'

export type UrlSafetyResult =
  | { safe: true, url: URL }
  | { safe: false, reason: UrlRejection }

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
 * What counts as safe, as one replaceable unit.
 *
 * It is a parameter so the guard's MECHANISM - redirect walking, subresource
 * refusal, the hop cap - can be exercised against a fixture server, which
 * necessarily listens on loopback and an ephemeral port: both of which the
 * real policy is determined to refuse, and rightly so.
 *
 * The POLICY itself is not tested that way. Every range and every port rule is
 * covered exhaustively by the specs sitting beside the real implementation in
 * infra/net, with no network at all. Splitting them keeps each honest: the
 * policy specs cannot be satisfied by a lenient mechanism, and the mechanism
 * specs cannot be satisfied by a lenient policy. Nothing in production passes
 * anything but the default.
 *
 * `isIpLiteral` is part of the port rather than a `node:net` call inlined
 * below, because recognising an address is the same runtime concern as
 * classifying one - and this file must stay free of the runtime. That is what
 * lets the whole rule set be pure: no DNS, no network, no clock, no imports at
 * all, which is the only reason it is cheap enough to test exhaustively.
 */
export type UrlPolicy = {
  isAllowedPort: (port: number) => boolean
  isBlockedAddress: (address: string) => boolean
  isIpLiteral: (host: string) => boolean
}

export const parseAuditUrl = (raw: string, policy: UrlPolicy): UrlSafetyResult => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { safe: false, reason: 'invalid-url' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { safe: false, reason: 'blocked-scheme' }
  }

  // Credentials survive normalisation, so an accepted URL would be stored and
  // then handed back by the public result endpoint - and cached for an hour -
  // exposing whatever was pasted in to everyone holding the share link.
  if (url.username !== '' || url.password !== '') {
    return { safe: false, reason: 'blocked-credentials' }
  }

  const port = url.port === '' ? DEFAULT_PORTS[url.protocol] : Number(url.port)
  if (port === undefined || !policy.isAllowedPort(port)) {
    return { safe: false, reason: 'blocked-port' }
  }

  // A literal address needs no DNS at all, and catching it here keeps the
  // most obvious attack out of the resolver path entirely.
  const host = bareHostname(url)
  if (policy.isIpLiteral(host) && policy.isBlockedAddress(host)) {
    return { safe: false, reason: 'blocked-address' }
  }

  return { safe: true, url }
}

/**
 * The canonical form a monitored page is stored and deduplicated under.
 *
 * `URL` has already done most of the work by the time this runs - the host is
 * lowercased, a default port is dropped, and an empty path becomes `/`, which
 * is what stops `example.com` and `example.com/` being two pages. What it does
 * NOT drop is the fragment, and a fragment is never sent to the server: two
 * urls differing only by one audit identically, so storing both would double
 * the cost and send two of every alert.
 *
 * The query string is kept. It routinely selects a different page, and
 * guessing which parameters are decorative is not something a monitor should
 * do on the user's behalf.
 *
 * A one-off anonymous audit deliberately does not go through this - it has no
 * uniqueness to enforce, and normalising the url a caller pasted would make
 * the result page disagree with what they typed.
 */
export const canonicalPageUrl = (url: URL): string => {
  const canonical = new URL(url.toString())
  canonical.hash = ''
  return canonical.toString()
}
