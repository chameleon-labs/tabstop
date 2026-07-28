import type { DnsResolver } from '../../data/protocols/net/dns-resolver.js'
import {
  bareHostname, parseAuditUrl, type UrlPolicy
} from '../../domain/services/url-safety.js'
import { DEFAULT_URL_POLICY } from '../net/ip-address-policy.js'

/** Chromium's own default is 20; five is ample for a page worth auditing. */
export const MAX_REDIRECTS = 5

export type FetchedResponse = {
  status: () => number
  headers: () => Record<string, string>
  /**
   * Playwright retains every fetched body until this is called or the context
   * is torn down. Since the guard now fetches every subresource as well as
   * every navigation, a page serving large responses could otherwise pile them
   * up in worker memory for the whole audit.
   */
  dispose: () => Promise<void>
}

/**
 * The shape of Playwright's Route, declared structurally so this file does not
 * import Playwright - which keeps the one-file rule intact and makes the whole
 * guard unit-testable against a fake.
 */
export type RouteLike = {
  request: () => {
    url: () => string
    isNavigationRequest: () => boolean
    method: () => string
    headers: () => Record<string, string>
    /**
     * The BUFFER, not postData(): that decodes as UTF-8, which corrupts binary
     * bodies and multipart uploads carrying arbitrary file bytes. Every
     * request passes through here now, so replaying a mangled body is not a
     * corner case.
     */
    postDataBuffer: () => Buffer | null
  }
  abort: (errorCode: string) => Promise<void>
  fetch: (options: {
    url: string
    method: string
    headers: Record<string, string>
    maxRedirects: number
    data?: Buffer
  }) => Promise<FetchedResponse>
  fulfill: (options: {
    response?: FetchedResponse
    status?: number
    headers?: Record<string, string>
    body?: string
  }) => Promise<void>
  continue: () => Promise<void>
}

/**
 * A redirect is not simply "the same request at a new URL".
 *
 * 303 always demotes to GET, and 301/302 do so universally in practice - every
 * browser has done it for decades. 307 and 308 exist precisely to preserve the
 * method. Replaying the original POST at every hop, which is what reusing the
 * request wholesale does, means repeating a side effect the server already
 * performed and sending a body to an endpoint that never expected one.
 */
const METHOD_PRESERVING_REDIRECTS = new Set([307, 308])

/**
 * Only these are redirects. `fetch` follows exactly this set, and a 3xx is not
 * automatically one: a 304 carrying a Location header would otherwise make the
 * auditor issue a request Chromium itself would never make.
 */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

type Attempt = { url: string, method: string, headers: Record<string, string>, data?: Buffer }

const followRedirect = (attempt: Attempt, status: number, url: string): Attempt => {
  if (METHOD_PRESERVING_REDIRECTS.has(status)) return { ...attempt, url }

  // Demoted to GET, so the body goes and the headers describing it go with it -
  // a content-length left on a bodyless GET is its own source of confusion.
  const { 'content-type': _type, 'content-length': _length, ...headers } = attempt.headers
  return { url, method: 'GET', headers }
}

/**
 * Taking over the fetch means taking over its failures too. A connection
 * refused inside the handler would otherwise escape as an unhandled route
 * error: the navigation is never answered, `page.goto` runs to its full
 * timeout, and a fast, accurate "Nothing responded at that address" becomes a
 * slow, wrong "The page took too long to load". Aborting with the matching
 * code puts the original net::ERR_* back in front of the classifier.
 */
const abortCodeFor = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  if (/ECONNREFUSED/.test(message)) return 'connectionrefused'
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(message)) return 'namenotresolved'
  if (/ETIMEDOUT|timeout/i.test(message)) return 'timedout'
  if (/ECONNRESET/.test(message)) return 'connectionreset'
  if (/EHOSTUNREACH|ENETUNREACH/.test(message)) return 'addressunreachable'
  return 'connectionfailed'
}

/**
 * Serve the body, then release Playwright's copy of it. fulfill() has already
 * handed the bytes to the browser by the time this resolves, so disposing
 * afterwards frees the Node-side buffer without affecting the page.
 */
const fulfilAndDispose = async (route: RouteLike, response: FetchedResponse): Promise<void> => {
  try {
    await route.fulfill({ response })
  } finally {
    await response.dispose()
  }
}

export const makeRequestGuard = (
  resolver: DnsResolver,
  policy: UrlPolicy = DEFAULT_URL_POLICY
) => {
  const isAddressSafe = async (url: URL): Promise<boolean> => {
    const host = bareHostname(url)
    if (policy.isIpLiteral(host)) return !policy.isBlockedAddress(host)

    const addresses = await resolver.resolve(host)
    // Empty means resolution failed: fail closed. And EVERY address has to be
    // safe - a host answering with one public and one private address is a
    // rebinding attempt, not a coincidence.
    return addresses.length > 0 && addresses.every((address) => !policy.isBlockedAddress(address))
  }

  const isSafe = async (raw: string): Promise<boolean> => {
    const parsed = parseAuditUrl(raw, policy)
    return parsed.safe && await isAddressSafe(parsed.url)
  }

  return async (route: RouteLike): Promise<void> => {
    const request = route.request()

    // Every request is walked, subresources included. Handing a subresource to
    // route.continue() after one check reintroduces exactly the bypass this
    // guard exists to close: Chromium follows its 30x internally and the
    // handler is never called for the target, so <img src="http://public/r">
    // redirecting to a metadata address would sail through.
    //
    // Navigations and subresources differ only in blast radius, which is a
    // property of what aborting DOES here, not of what gets checked: refusing
    // a navigation fails the audit, refusing a subresource leaves the page
    // auditable without it.
    //
    // Redirect-following is taken away from the browser deliberately.
    // Verified: context.route fires only for the FIRST hop, so a 302 to a
    // private address is followed internally and never offered here - the
    // redirect check simply would not happen, and page.goto resolves with the
    // private response in the page. Walking the chain by hand is what makes
    // every hop checkable, and it makes the cap countable too, which
    // page.goto does not otherwise expose.
    const body = request.postDataBuffer()
    const originalUrl = request.url()
    let attempt: Attempt = {
      url: originalUrl,
      method: request.method(),
      headers: request.headers(),
      ...(body === null ? {} : { data: body })
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!await isSafe(attempt.url)) return await route.abort('blockedbyclient')

      let response: FetchedResponse
      try {
        response = await route.fetch({ ...attempt, maxRedirects: 0 })
      } catch (error) {
        return await route.abort(abortCodeFor(error))
      }

      const status = response.status()
      if (!REDIRECT_STATUSES.has(status)) {
        // The chain ended here. If it never moved, serve what we fetched.
        if (attempt.url === originalUrl) return await fulfilAndDispose(route, response)

        // It DID move, and fulfilling this body against the original request
        // would collapse the chain: Playwright copies status, headers and body
        // onto the FIRST url, so Chromium keeps the document at the start
        // address. Measured - `/start` redirecting to `/dir/page` left the
        // page at `/start`, resolved `<img src="asset.png">` to `/asset.png`
        // (a 404), and ran the target's content under the start origin.
        //
        // So hand the browser a redirect to the final url instead and let it
        // own the document. Every hop has already been checked on the way
        // here; the cost is that the final url is fetched once more, by the
        // browser, which for a page audit is a repeated GET.
        await response.dispose()
        return await route.fulfill({
          status: 302,
          headers: { location: attempt.url },
          body: ''
        })
      }

      const location = response.headers().location
      if (location === undefined) return await fulfilAndDispose(route, response)

      // An intermediate hop's body is never served, so it is dead weight the
      // moment its status and Location have been read.
      await response.dispose()

      let target: string
      try {
        target = new URL(location, attempt.url).toString()
      } catch {
        // A malformed Location thrown from here would escape the fetch
        // handler above and leave the route unanswered, turning an invalid
        // redirect into a full navigation timeout and three audit attempts
        // rather than one prompt, classified failure.
        return await route.abort('blockedbyclient')
      }

      attempt = followRedirect(attempt, status, target)
    }

    return await route.abort('blockedbyclient')
  }
}
