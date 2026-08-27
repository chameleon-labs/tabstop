import type {DnsResolver} from '../../data/protocols/net/dns-resolver.js';
import {bareHostname, parseAuditUrl, type UrlPolicy} from '../../domain/services/url-safety.js';
import {DEFAULT_URL_POLICY} from '../net/ip-address-policy.js';

export const MAX_REDIRECTS = 5;

export type FetchedResponse = {
  status: () => number;
  headers: () => Record<string, string>;
  dispose: () => Promise<void>;
};

export type RouteLike = {
  request: () => {
    url: () => string;
    isNavigationRequest: () => boolean;
    method: () => string;
    headers: () => Record<string, string>;
    postDataBuffer: () => Buffer | null;
  };
  abort: (errorCode: string) => Promise<void>;
  fetch: (options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    maxRedirects: number;
    data?: Buffer;
  }) => Promise<FetchedResponse>;
  fulfill: (options: {
    response?: FetchedResponse;
    status?: number;
    headers?: Record<string, string>;
    body?: string;
  }) => Promise<void>;
  continue: () => Promise<void>;
};

const METHOD_PRESERVING_REDIRECTS = new Set([307, 308]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type Attempt = {url: string; method: string; headers: Record<string, string>; data?: Buffer};

const followRedirect = (attempt: Attempt, status: number, url: string): Attempt => {
  if (METHOD_PRESERVING_REDIRECTS.has(status)) {
    return {...attempt, url};
  }

  const {'content-type': _type, 'content-length': _length, ...headers} = attempt.headers;
  return {url, method: 'GET', headers};
};

const abortCodeFor = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED/.test(message)) {
    return 'connectionrefused';
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(message)) {
    return 'namenotresolved';
  }
  if (/ETIMEDOUT|timeout/i.test(message)) {
    return 'timedout';
  }
  if (/ECONNRESET/.test(message)) {
    return 'connectionreset';
  }
  if (/EHOSTUNREACH|ENETUNREACH/.test(message)) {
    return 'addressunreachable';
  }
  return 'connectionfailed';
};

const fulfilAndDispose = async (route: RouteLike, response: FetchedResponse): Promise<void> => {
  try {
    await route.fulfill({response});
  } finally {
    await response.dispose();
  }
};

export const makeRequestGuard = (resolver: DnsResolver, policy: UrlPolicy = DEFAULT_URL_POLICY) => {
  const isAddressSafe = async (url: URL): Promise<boolean> => {
    const host = bareHostname(url);
    if (policy.isIpLiteral(host)) {
      return !policy.isBlockedAddress(host);
    }

    const addresses = await resolver.resolve(host);
    return addresses.length > 0 && addresses.every((address) => !policy.isBlockedAddress(address));
  };

  const isSafe = async (raw: string): Promise<boolean> => {
    const parsed = parseAuditUrl(raw, policy);
    return parsed.safe && (await isAddressSafe(parsed.url));
  };

  return async (route: RouteLike): Promise<void> => {
    const request = route.request();

    const body = request.postDataBuffer();
    const originalUrl = request.url();
    let attempt: Attempt = {
      url: originalUrl,
      method: request.method(),
      headers: request.headers(),
      ...(body === null ? {} : {data: body}),
    };

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await isSafe(attempt.url))) {
        return await route.abort('blockedbyclient');
      }

      let response: FetchedResponse;
      try {
        response = await route.fetch({...attempt, maxRedirects: 0});
      } catch (error) {
        return await route.abort(abortCodeFor(error));
      }

      const status = response.status();
      if (!REDIRECT_STATUSES.has(status)) {
        if (attempt.url === originalUrl) {
          return await fulfilAndDispose(route, response);
        }

        await response.dispose();
        return await route.fulfill({
          status: 302,
          headers: {location: attempt.url},
          body: '',
        });
      }

      const {location} = response.headers();
      if (location === undefined) {
        return await fulfilAndDispose(route, response);
      }

      await response.dispose();

      let target: string;
      try {
        target = new URL(location, attempt.url).toString();
      } catch {
        return await route.abort('blockedbyclient');
      }

      attempt = followRedirect(attempt, status, target);
    }

    return await route.abort('blockedbyclient');
  };
};
