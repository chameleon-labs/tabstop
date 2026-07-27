import { isIP } from 'node:net'
import type { DnsResolver } from '../../data/protocols/net/dns-resolver.js'
import {
  DEFAULT_URL_POLICY, bareHostname, parseAuditUrl, type UrlPolicy
} from '../../domain/services/url-safety.js'

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
  request: () => {
    url: () => string
    isNavigationRequest: () => boolean
    method: () => string
    headers: () => Record<string, string>
    postData: () => string | null
  }
  abort: (errorCode: string) => Promise<void>
  fetch: (options: {
    url: string
    method: string
    headers: Record<string, string>
    maxRedirects: number
    data?: string
  }) => Promise<FetchedResponse>
  fulfill: (options: { response: FetchedResponse }) => Promise<void>
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

type Attempt = { url: string, method: string, headers: Record<string, string>, data?: string }

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

export const makeRequestGuard = (
  resolver: DnsResolver,
  policy: UrlPolicy = DEFAULT_URL_POLICY
) => {
  const isAddressSafe = async (url: URL): Promise<boolean> => {
    const host = bareHostname(url)
    if (isIP(host) !== 0) return !policy.isBlockedAddress(host)

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
    const body = request.postData()
    let attempt: Attempt = {
      url: request.url(),
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
      if (status < 300 || status >= 400) return await route.fulfill({ response })

      const location = response.headers().location
      if (location === undefined) return await route.fulfill({ response })

      attempt = followRedirect(attempt, status, new URL(location, attempt.url).toString())
    }

    return await route.abort('blockedbyclient')
  }
}
