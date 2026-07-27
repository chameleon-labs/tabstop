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

  describe('subresources', () => {
    it('lets an ordinary public subresource through', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC))
      const { route } = makeRoute('https://example.com/logo.png', { navigation: false })

      await guard(route as unknown as RouteLike)

      expect(route.continue).toHaveBeenCalledTimes(1)
      expect(route.fetch).not.toHaveBeenCalled()
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

    it('refuses only itself, never walking a redirect chain', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC))
      const { route } = makeRoute('http://10.0.0.5/x.png', { navigation: false })

      await guard(route as unknown as RouteLike)

      expect(route.fetch).not.toHaveBeenCalled()
    })
  })
})
