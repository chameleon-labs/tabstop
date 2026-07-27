import { isIP } from 'node:net'
import type { DnsResolver } from '../../data/protocols/net/dns-resolver.js'
import { bareHostname, isBlockedAddress, parseAuditUrl } from '../../domain/services/url-safety.js'

/** Chromium's own default is 20; five is ample for a page worth auditing. */
export const MAX_REDIRECTS = 5

export type FetchedResponse = {
  status: () => number
  headers: () => Record<string, string>
}

/**
 * The shape of Playwright's Route, declared structurally so this file does not
 * import Playwright - which keeps the one-file rule intact and makes the whole
 * guard unit-testable against a fake.
 */
export type RouteLike = {
  request: () => { url: () => string, isNavigationRequest: () => boolean }
  abort: (errorCode: string) => Promise<void>
  fetch: (options: { url: string, maxRedirects: number }) => Promise<FetchedResponse>
  fulfill: (options: { response: FetchedResponse }) => Promise<void>
  continue: () => Promise<void>
}

export const makeRequestGuard = (resolver: DnsResolver) => {
  const isAddressSafe = async (url: URL): Promise<boolean> => {
    const host = bareHostname(url)
    if (isIP(host) !== 0) return !isBlockedAddress(host)

    const addresses = await resolver.resolve(host)
    // Empty means resolution failed: fail closed. And EVERY address has to be
    // safe - a host answering with one public and one private address is a
    // rebinding attempt, not a coincidence.
    return addresses.length > 0 && addresses.every((address) => !isBlockedAddress(address))
  }

  const isSafe = async (raw: string): Promise<boolean> => {
    const parsed = parseAuditUrl(raw)
    return parsed.safe && await isAddressSafe(parsed.url)
  }

  return async (route: RouteLike): Promise<void> => {
    const request = route.request()

    // Subresources are checked but never walked, and a blocked one refuses
    // only itself: a page that innocently references an unreachable internal
    // host stays auditable rather than failing outright.
    if (!request.isNavigationRequest()) {
      if (await isSafe(request.url())) return await route.continue()
      return await route.abort('blockedbyclient')
    }

    // Redirect-following is taken away from the browser deliberately.
    // Verified: context.route fires only for the FIRST hop, so a 302 to a
    // private address is followed internally and never offered here - the
    // redirect check simply would not happen, and page.goto resolves with the
    // private response in the page. Walking the chain by hand is what makes
    // every hop checkable, and it makes the cap countable too, which
    // page.goto does not otherwise expose.
    let url = request.url()

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!await isSafe(url)) return await route.abort('blockedbyclient')

      const response = await route.fetch({ url, maxRedirects: 0 })
      const status = response.status()
      if (status < 300 || status >= 400) return await route.fulfill({ response })

      const location = response.headers().location
      if (location === undefined) return await route.fulfill({ response })

      url = new URL(location, url).toString()
    }

    return await route.abort('blockedbyclient')
  }
}
