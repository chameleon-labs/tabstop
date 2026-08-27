export type UrlRejection =
  | 'invalid-url'
  | 'blocked-scheme'
  | 'blocked-port'
  | 'blocked-address'
  | 'blocked-credentials';

export type UrlSafetyResult = {safe: true; url: URL} | {safe: false; reason: UrlRejection};

export const ALLOWED_PORTS: readonly number[] = [80, 443];

const DEFAULT_PORTS: Readonly<Record<string, number>> = {'http:': 80, 'https:': 443};

export const bareHostname = (url: URL): string =>
  url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;

export type UrlPolicy = {
  isAllowedPort: (port: number) => boolean;
  isBlockedAddress: (address: string) => boolean;
  isIpLiteral: (host: string) => boolean;
};

export const parseAuditUrl = (raw: string, policy: UrlPolicy): UrlSafetyResult => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {safe: false, reason: 'invalid-url'};
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {safe: false, reason: 'blocked-scheme'};
  }

  if (url.username !== '' || url.password !== '') {
    return {safe: false, reason: 'blocked-credentials'};
  }

  const port = url.port === '' ? DEFAULT_PORTS[url.protocol] : Number(url.port);
  if (port === undefined || !policy.isAllowedPort(port)) {
    return {safe: false, reason: 'blocked-port'};
  }

  const host = bareHostname(url);
  if (policy.isIpLiteral(host) && policy.isBlockedAddress(host)) {
    return {safe: false, reason: 'blocked-address'};
  }

  return {safe: true, url};
};

export const canonicalPageUrl = (url: URL): string => {
  const canonical = new URL(url.toString());
  canonical.hash = '';
  return canonical.toString();
};
