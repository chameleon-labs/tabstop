export type UrlProblem = 'empty' | 'unparseable';

export type UrlInput = {ok: true; url: string} | {ok: false; problem: UrlProblem};

export const URL_PROBLEMS: Readonly<Record<UrlProblem, string>> = {
  empty: 'Enter a URL to audit',
  unparseable: 'That does not look like a URL',
};

const HIERARCHICAL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const HOST_AND_PORT = /^(?:localhost|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+):\d/i;
const OPAQUE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const hasScheme = (input: string): boolean => {
  if (HIERARCHICAL_SCHEME.test(input)) {
    return true;
  }
  if (HOST_AND_PORT.test(input)) {
    return false;
  }
  return OPAQUE_SCHEME.test(input);
};

export const normaliseUrl = (raw: string): UrlInput => {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return {ok: false, problem: 'empty'};
  }

  const candidate = hasScheme(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {ok: false, problem: 'unparseable'};
  }

  if (parsed.hostname === '') {
    return {ok: false, problem: 'unparseable'};
  }

  return {ok: true, url: parsed.href};
};

export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
