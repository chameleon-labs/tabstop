import {describe, expect, it, vi} from 'vitest';
import {makeRequestGuard, type FetchedResponse, type RouteLike} from './request-guard.js';
import type {DnsResolver} from '../../data/protocols/net/dns-resolver.js';

const response = (status: number, headers: Record<string, string> = {}): FetchedResponse => ({
  status: () => status,
  headers: () => headers,
  dispose: vi.fn(async () => {}),
});

type Attempted = {url: string; method: string; headers: Record<string, string>; data?: Buffer};

const makeRoute = (
  url: string,
  options: {
    navigation?: boolean;
    responses?: FetchedResponse[];
    method?: string;
    headers?: Record<string, string>;
    postData?: string | null;
    binaryBody?: Buffer;
  } = {},
) => {
  const responses = options.responses ?? [response(200)];
  let served = 0;
  const fetched: string[] = [];
  const attempts: Attempted[] = [];

  const route = {
    request: () => ({
      url: () => url,
      isNavigationRequest: () => options.navigation ?? true,
      method: () => options.method ?? 'GET',
      headers: () => options.headers ?? {},
      postDataBuffer: () =>
        options.binaryBody ??
        (options.postData === undefined || options.postData === null ? null : Buffer.from(options.postData)),
    }),
    abort: vi.fn(async (_errorCode: string) => {}),
    fetch: vi.fn((attempt: Attempted & {maxRedirects: number}) => {
      fetched.push(attempt.url);
      attempts.push(attempt);
      return Promise.resolve(responses[Math.min(served++, responses.length - 1)] as FetchedResponse);
    }),
    fulfill: vi.fn(async (_options: {response: FetchedResponse}) => {}),
    continue: vi.fn(async () => {}),
  };
  return {route, fetched, attempts};
};

const resolverFor = (map: Record<string, string[]>): DnsResolver => ({
  resolve: vi.fn((hostname: string) => Promise.resolve(map[hostname] ?? [])),
});

const PUBLIC = {'example.com': ['93.184.216.34'], 'evil.test': ['93.184.216.34']};

describe('makeRequestGuard', () => {
  describe('navigation', () => {
    it('fulfils an ordinary public navigation', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route} = makeRoute('https://example.com/');

      await guard(route as unknown as RouteLike);

      expect(route.fulfill).toHaveBeenCalledTimes(1);
      expect(route.abort).not.toHaveBeenCalled();
    });

    it('blocks a literal private address without consulting DNS', async () => {
      const resolver = resolverFor({});
      const guard = makeRequestGuard(resolver);
      const {route} = makeRoute('http://169.254.169.254/latest/meta-data/');

      await guard(route as unknown as RouteLike);

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it('blocks a hostname that resolves to a private address', async () => {
      const guard = makeRequestGuard(resolverFor({'evil.test': ['10.0.0.5']}));
      const {route} = makeRoute('https://evil.test/');

      await guard(route as unknown as RouteLike);

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    });

    it('blocks a host answering with one public and one private address', async () => {
      const guard = makeRequestGuard(resolverFor({'evil.test': ['93.184.216.34', '10.0.0.5']}));
      const {route} = makeRoute('https://evil.test/');

      await guard(route as unknown as RouteLike);

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    });

    it('blocks when resolution fails, rather than allowing', async () => {
      const guard = makeRequestGuard(resolverFor({}));
      const {route} = makeRoute('https://unknown.test/');

      await guard(route as unknown as RouteLike);

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    });

    it('blocks a public host that redirects to a private one', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route} = makeRoute('https://example.com/redirect', {
        responses: [response(302, {location: 'http://169.254.169.254/'})],
      });

      await guard(route as unknown as RouteLike);

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
      expect(route.fulfill).not.toHaveBeenCalled();
    });

    it('blocks a redirect to a non-http scheme', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route} = makeRoute('https://example.com/redirect', {
        responses: [response(302, {location: 'file:///etc/passwd'})],
      });

      await guard(route as unknown as RouteLike);

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    });

    it('follows an ordinary redirect chain and fulfils the final response', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route, fetched} = makeRoute('https://example.com/a', {
        responses: [response(302, {location: 'https://example.com/b'}), response(301, {location: '/c'}), response(200)],
      });

      await guard(route as unknown as RouteLike);

      expect(fetched).toEqual(['https://example.com/a', 'https://example.com/b', 'https://example.com/c']);
      expect(route.fulfill).toHaveBeenCalledTimes(1);
      expect(route.abort).not.toHaveBeenCalled();
    });

    it('aborts once the redirect cap is exceeded', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route, fetched} = makeRoute('https://example.com/loop', {
        responses: [response(302, {location: 'https://example.com/loop'})],
      });

      await guard(route as unknown as RouteLike);

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
      expect(fetched.length).toBeLessThanOrEqual(6);
    });

    it('fulfils a redirect status that carries no location header', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route} = makeRoute('https://example.com/', {responses: [response(304)]});

      await guard(route as unknown as RouteLike);

      expect(route.fulfill).toHaveBeenCalledTimes(1);
    });
  });

  describe('redirect semantics', () => {
    it('demotes a POST to GET and drops its body on a 303', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route, attempts} = makeRoute('https://example.com/submit', {
        method: 'POST',
        postData: 'name=value',
        headers: {'content-type': 'application/x-www-form-urlencoded', 'content-length': '10'},
        responses: [response(303, {location: '/done'}), response(200)],
      });

      await guard(route as unknown as RouteLike);

      expect(attempts[0]?.method).toBe('POST');
      expect(attempts[0]?.data?.toString()).toBe('name=value');
      expect(attempts[1]?.method).toBe('GET');
      expect(attempts[1]?.data).toBeUndefined();
      expect(attempts[1]?.headers['content-type']).toBeUndefined();
      expect(attempts[1]?.headers['content-length']).toBeUndefined();
    });

    it('demotes a POST to GET on 301 and 302, as every browser does', async () => {
      for (const status of [301, 302]) {
        const guard = makeRequestGuard(resolverFor(PUBLIC));
        const {route, attempts} = makeRoute('https://example.com/submit', {
          method: 'POST',
          postData: 'name=value',
          responses: [response(status, {location: '/done'}), response(200)],
        });

        await guard(route as unknown as RouteLike);

        expect(attempts[1]?.method).toBe('GET');
        expect(attempts[1]?.data).toBeUndefined();
      }
    });

    it('preserves the method and body on 307 and 308', async () => {
      for (const status of [307, 308]) {
        const guard = makeRequestGuard(resolverFor(PUBLIC));
        const {route, attempts} = makeRoute('https://example.com/submit', {
          method: 'POST',
          postData: 'name=value',
          responses: [response(status, {location: '/elsewhere'}), response(200)],
        });

        await guard(route as unknown as RouteLike);

        expect(attempts[1]?.method).toBe('POST');
        expect(attempts[1]?.data?.toString()).toBe('name=value');
      }
    });

    it('carries the original method through when there is no redirect', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route, attempts} = makeRoute('https://example.com/api', {
        navigation: false,
        method: 'POST',
        postData: '{"a":1}',
        headers: {'content-type': 'application/json'},
      });

      await guard(route as unknown as RouteLike);

      expect(attempts[0]?.method).toBe('POST');
      expect(attempts[0]?.data?.toString()).toBe('{"a":1}');
      expect(attempts[0]?.headers['content-type']).toBe('application/json');
    });
  });

  describe('when the fetch itself fails', () => {
    const rejectingRoute = (message: string) => ({
      request: () => ({
        url: () => 'https://example.com/',
        isNavigationRequest: () => true,
        method: () => 'GET',
        headers: () => ({}),
        postDataBuffer: () => null,
      }),
      abort: vi.fn(async (_code: string) => {}),
      fetch: vi.fn(() => Promise.reject(new Error(message))),
      fulfill: vi.fn(async () => {}),
      continue: vi.fn(async () => {}),
    });

    it('translates the failure into the matching abort code', async () => {
      const cases: [string, string][] = [
        ['connect ECONNREFUSED 127.0.0.1:45999', 'connectionrefused'],
        ['getaddrinfo ENOTFOUND nope.invalid', 'namenotresolved'],
        ['socket hang up ECONNRESET', 'connectionreset'],
        ['connect EHOSTUNREACH 10.0.0.5', 'addressunreachable'],
        ['something nobody predicted', 'connectionfailed'],
      ];

      for (const [message, expected] of cases) {
        const guard = makeRequestGuard(resolverFor(PUBLIC));
        const route = rejectingRoute(message);

        await guard(route as unknown as RouteLike);

        expect(route.abort).toHaveBeenCalledWith(expected);
      }
    });

    it('never lets a fetch failure escape the guard', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));

      await expect(guard(rejectingRoute('connect ECONNREFUSED') as unknown as RouteLike)).resolves.toBeUndefined();
    });
  });

  describe('subresources', () => {
    it('serves an ordinary public subresource', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route} = makeRoute('https://example.com/logo.png', {navigation: false});

      await guard(route as unknown as RouteLike);

      expect(route.fulfill).toHaveBeenCalledTimes(1);
      expect(route.abort).not.toHaveBeenCalled();
    });

    it('blocks a subresource pointed at a private address', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route} = makeRoute('http://169.254.169.254/latest/meta-data/', {navigation: false});

      await guard(route as unknown as RouteLike);

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
      expect(route.continue).not.toHaveBeenCalled();
    });

    it('walks a subresource redirect instead of handing it to the browser', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route} = makeRoute('https://example.com/tracker.png', {
        navigation: false,
        responses: [response(302, {location: 'http://169.254.169.254/latest/meta-data/'})],
      });

      await guard(route as unknown as RouteLike);

      expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
      expect(route.fulfill).not.toHaveBeenCalled();
    });

    it('fulfils an ordinary subresource redirect chain', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route} = makeRoute('https://example.com/a.png', {
        navigation: false,
        responses: [response(302, {location: 'https://example.com/b.png'}), response(200)],
      });

      await guard(route as unknown as RouteLike);

      expect(route.fulfill).toHaveBeenCalledTimes(1);
      expect(route.abort).not.toHaveBeenCalled();
    });
  });

  describe('memory', () => {
    it('disposes an intermediate redirect response, whose body is never served', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const intermediate = response(302, {location: 'https://example.com/b'});
      const final = response(200);
      const {route} = makeRoute('https://example.com/a', {
        responses: [intermediate, final],
      });

      await guard(route as unknown as RouteLike);

      expect(intermediate.dispose).toHaveBeenCalledTimes(1);
    });

    it('disposes the final response once it has been served', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const final = response(200);
      const {route} = makeRoute('https://example.com/a', {responses: [final]});

      await guard(route as unknown as RouteLike);

      expect(route.fulfill).toHaveBeenCalledTimes(1);
      expect(final.dispose).toHaveBeenCalledTimes(1);
    });
  });

  describe('statuses that are not redirects', () => {
    it('does not follow a 304 that carries a Location header', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route, fetched} = makeRoute('https://example.com/a', {
        responses: [response(304, {location: 'http://169.254.169.254/'})],
      });

      await guard(route as unknown as RouteLike);

      expect(fetched).toEqual(['https://example.com/a']);
      expect(route.fulfill).toHaveBeenCalledTimes(1);
      expect(route.abort).not.toHaveBeenCalled();
    });
  });

  describe('a malformed Location header', () => {
    it('aborts deterministically rather than leaving the route unanswered', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route} = makeRoute('https://example.com/a', {
        responses: [response(302, {location: 'http://[not a url'})],
      });

      await expect(guard(route as unknown as RouteLike)).resolves.toBeUndefined();
      expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    });
  });

  describe('preserving the browser-visible URL', () => {
    it('redirects the browser to the final url instead of collapsing the chain', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route} = makeRoute('https://example.com/start', {
        responses: [response(302, {location: '/dir/page'}), response(200)],
      });

      await guard(route as unknown as RouteLike);

      expect(route.fulfill).toHaveBeenCalledWith({
        status: 302,
        headers: {location: 'https://example.com/dir/page'},
        body: '',
      });
    });

    it('serves the response directly when nothing redirected', async () => {
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const final = response(200);
      const {route} = makeRoute('https://example.com/', {responses: [final]});

      await guard(route as unknown as RouteLike);

      expect(route.fulfill).toHaveBeenCalledWith({response: final});
    });
  });

  describe('binary request bodies', () => {
    it('replays the bytes it was given, not a UTF-8 round trip', async () => {
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
      const guard = makeRequestGuard(resolverFor(PUBLIC));
      const {route, attempts} = makeRoute('https://example.com/upload', {
        navigation: false,
        method: 'POST',
        binaryBody: bytes,
      });

      await guard(route as unknown as RouteLike);

      expect(attempts[0]?.data).toEqual(bytes);
      expect(Buffer.compare(attempts[0]?.data ?? Buffer.alloc(0), bytes)).toBe(0);
    });
  });
});
