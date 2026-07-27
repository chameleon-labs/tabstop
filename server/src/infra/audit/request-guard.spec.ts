import { describe, expect, it, vi } from 'vitest'
import { makeRequestGuard, type FetchedResponse, type RouteLike } from './request-guard.js'
import type { DnsResolver } from '../../data/protocols/net/dns-resolver.js'

const response = (status: number, headers: Record<string, string> = {}): FetchedResponse => ({
  status: () => status,
  headers: () => headers
})

const makeRoute = (url: string, options: {
  navigation?: boolean
  responses?: FetchedResponse[]
} = {}) => {
  const responses = options.responses ?? [response(200)]
  let served = 0
  const fetched: string[] = []

  const route = {
    request: () => ({ url: () => url, isNavigationRequest: () => options.navigation ?? true }),
    abort: vi.fn(async (_errorCode: string) => { /* no-op */ }),
    fetch: vi.fn(async ({ url: fetchUrl }: { url: string, maxRedirects: number }) => {
      fetched.push(fetchUrl)
      return responses[Math.min(served++, responses.length - 1)] as FetchedResponse
    }),
    fulfill: vi.fn(async (_options: { response: FetchedResponse }) => { /* no-op */ }),
    continue: vi.fn(async () => { /* no-op */ })
  }
  return { route, fetched }
}

const resolverFor = (map: Record<string, string[]>): DnsResolver => ({
  resolve: vi.fn(async (hostname: string) => map[hostname] ?? [])
})

const PUBLIC = { 'example.com': ['93.184.216.34'], 'evil.test': ['93.184.216.34'] }

describe('makeRequestGuard', () => {
  describe('navigation', () => {
    it('fulfils an ordinary public navigation', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC))
      const { route } = makeRoute('https://example.com/')

      await guard(route as unknown as RouteLike)

      expect(route.fulfill).toHaveBeenCalledTimes(1)
      expect(route.abort).not.toHaveBeenCalled()
    })

    it('blocks a literal private address without consulting DNS', async () => {
      const resolver = resolverFor({})
      const guard = makeRequestGuard(resolver)
      const { route } = makeRoute('http://169.254.169.254/latest/meta-data/')

      await guard(route as unknown as RouteLike)

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient')
      expect(resolver.resolve).not.toHaveBeenCalled()
    })

    it('blocks a hostname that resolves to a private address', async () => {
      const guard = makeRequestGuard(resolverFor({ 'evil.test': ['10.0.0.5'] }))
      const { route } = makeRoute('https://evil.test/')

      await guard(route as unknown as RouteLike)

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient')
    })

    it('blocks a host answering with one public and one private address', async () => {
      // Taking only the first answer would wave this straight through.
      const guard = makeRequestGuard(resolverFor({ 'evil.test': ['93.184.216.34', '10.0.0.5'] }))
      const { route } = makeRoute('https://evil.test/')

      await guard(route as unknown as RouteLike)

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient')
    })

    it('blocks when resolution fails, rather than allowing', async () => {
      const guard = makeRequestGuard(resolverFor({}))
      const { route } = makeRoute('https://unknown.test/')

      await guard(route as unknown as RouteLike)

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient')
    })

    it('blocks a public host that redirects to a private one', async () => {
      // THE case the issue's own mechanism misses: context.route never fires
      // for the redirect target, so without this walk the private response
      // lands in the page.
      const guard = makeRequestGuard(resolverFor(PUBLIC))
      const { route } = makeRoute('https://example.com/redirect', {
        responses: [response(302, { location: 'http://169.254.169.254/' })]
      })

      await guard(route as unknown as RouteLike)

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient')
      expect(route.fulfill).not.toHaveBeenCalled()
    })

    it('blocks a redirect to a non-http scheme', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC))
      const { route } = makeRoute('https://example.com/redirect', {
        responses: [response(302, { location: 'file:///etc/passwd' })]
      })

      await guard(route as unknown as RouteLike)

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient')
    })

    it('follows an ordinary redirect chain and fulfils the final response', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC))
      const { route, fetched } = makeRoute('https://example.com/a', {
        responses: [
          response(302, { location: 'https://example.com/b' }),
          response(301, { location: '/c' }),
          response(200)
        ]
      })

      await guard(route as unknown as RouteLike)

      expect(fetched).toEqual([
        'https://example.com/a', 'https://example.com/b', 'https://example.com/c'
      ])
      expect(route.fulfill).toHaveBeenCalledTimes(1)
      expect(route.abort).not.toHaveBeenCalled()
    })

    it('aborts once the redirect cap is exceeded', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC))
      const { route, fetched } = makeRoute('https://example.com/loop', {
        responses: [response(302, { location: 'https://example.com/loop' })]
      })

      await guard(route as unknown as RouteLike)

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient')
      expect(fetched.length).toBeLessThanOrEqual(6)
    })

    it('fulfils a redirect status that carries no location header', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC))
      const { route } = makeRoute('https://example.com/', { responses: [response(304)] })

      await guard(route as unknown as RouteLike)

      expect(route.fulfill).toHaveBeenCalledTimes(1)
    })
  })

  describe('when the fetch itself fails', () => {
    const rejectingRoute = (message: string) => ({
      request: () => ({ url: () => 'https://example.com/', isNavigationRequest: () => true }),
      abort: vi.fn(async (_code: string) => { /* no-op */ }),
      fetch: vi.fn(async () => { throw new Error(message) }),
      fulfill: vi.fn(async () => { /* no-op */ }),
      continue: vi.fn(async () => { /* no-op */ })
    })

    it('translates the failure into the matching abort code', async () => {
      // Taking over the fetch means taking over its failures. Left to escape,
      // the route is never answered, page.goto runs to its full timeout, and a
      // fast "Nothing responded at that address" becomes a slow, wrong "The
      // page took too long to load".
      const cases: Array<[string, string]> = [
        ['connect ECONNREFUSED 127.0.0.1:45999', 'connectionrefused'],
        ['getaddrinfo ENOTFOUND nope.invalid', 'namenotresolved'],
        ['socket hang up ECONNRESET', 'connectionreset'],
        ['connect EHOSTUNREACH 10.0.0.5', 'addressunreachable'],
        ['something nobody predicted', 'connectionfailed']
      ]

      for (const [message, expected] of cases) {
        const guard = makeRequestGuard(resolverFor(PUBLIC))
        const route = rejectingRoute(message)

        await guard(route as unknown as RouteLike)

        expect(route.abort).toHaveBeenCalledWith(expected)
      }
    })

    it('never lets a fetch failure escape the guard', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC))

      await expect(guard(rejectingRoute('connect ECONNREFUSED') as unknown as RouteLike))
        .resolves.toBeUndefined()
    })
  })

  describe('subresources', () => {
    it('serves an ordinary public subresource', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC))
      const { route } = makeRoute('https://example.com/logo.png', { navigation: false })

      await guard(route as unknown as RouteLike)

      expect(route.fulfill).toHaveBeenCalledTimes(1)
      expect(route.abort).not.toHaveBeenCalled()
    })

    it('blocks a subresource pointed at a private address', async () => {
      // <img src="http://169.254.169.254/..."> reaches nothing the user can
      // read, but the request still fires from inside the network.
      const guard = makeRequestGuard(resolverFor(PUBLIC))
      const { route } = makeRoute('http://169.254.169.254/latest/meta-data/', { navigation: false })

      await guard(route as unknown as RouteLike)

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient')
      expect(route.continue).not.toHaveBeenCalled()
    })

    it('walks a subresource redirect instead of handing it to the browser', async () => {
      // The same bypass as the navigation case, one level down: continue() on
      // a public subresource lets Chromium follow its 30x internally, and the
      // handler is never called for the target - so an attacker-controlled
      // image URL could redirect to a metadata address unchecked.
      const guard = makeRequestGuard(resolverFor(PUBLIC))
      const { route } = makeRoute('https://example.com/tracker.png', {
        navigation: false,
        responses: [response(302, { location: 'http://169.254.169.254/latest/meta-data/' })]
      })

      await guard(route as unknown as RouteLike)

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient')
      expect(route.fulfill).not.toHaveBeenCalled()
    })

    it('fulfils an ordinary subresource redirect chain', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC))
      const { route } = makeRoute('https://example.com/a.png', {
        navigation: false,
        responses: [response(302, { location: 'https://example.com/b.png' }), response(200)]
      })

      await guard(route as unknown as RouteLike)

      expect(route.fulfill).toHaveBeenCalledTimes(1)
      expect(route.abort).not.toHaveBeenCalled()
    })
  })
})
