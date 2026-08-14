/**
 * What the input box does to what someone typed, before it is submitted.
 *
 * THE CLIENT IS FORGIVING, NOT AUTHORITATIVE. It rejects only what it can judge
 * without knowing any policy - nothing typed, and nothing that reads as a URL.
 * Blocked schemes, ports, private addresses and credentials belong to the
 * server, which owns those rules and the sentences explaining them; a second
 * copy here would drift from the one table those answers must come from.
 */
export type UrlProblem = 'empty' | 'unparseable';

export type UrlInput = {ok: true; url: string} | {ok: false; problem: UrlProblem};

/**
 * Messages for the two cases the server never sees, so they are ours to write.
 * Anything else is quoted from the response.
 */
export const URL_PROBLEMS: Readonly<Record<UrlProblem, string>> = {
  empty: 'Enter a URL to audit',
  unparseable: 'That does not look like a URL',
};

/**
 * `example.com:8080` and `mailto:someone@example.com` are THE SAME SYNTAX: a
 * scheme is `[a-z][a-z0-9+.-]*:`, which any `host:port` matches exactly. One
 * scheme test therefore turned every `host:port` into an unparseable URL.
 *
 * What separates them is what follows the colon. `://` is unambiguous. A digit
 * only suggests a port - `mailto:123` has one too, and reading it as a host
 * rewrote it to `https://mailto:123/` - so the part before the colon must also
 * look like a host: dotted, or `localhost`. Anything else is an opaque scheme,
 * left alone so the host check below rejects it.
 *
 * `foo:123` stays ambiguous and is read as a scheme, which fails safe: "that
 * does not look like a URL" beats auditing a different site than the one asked
 * for.
 */
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

/**
 * `example.com` becomes `https://example.com/`.
 *
 * https when none is given, because a bare domain is https and guessing
 * otherwise costs a redirect. An explicit `http://` is preserved rather than
 * upgraded: auditing a different URL than the one shown back is worse.
 *
 * Returns the canonical `href`, which is also what is displayed - showing one
 * string and submitting another is its own class of confusion.
 */
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

  // `javascript:alert(1)` and `mailto:a@b.com` parse fine and have no host.
  // Rejecting on the host keeps scheme policy in one place - the server's.
  if (parsed.hostname === '') {
    return {ok: false, problem: 'unparseable'};
  }

  return {ok: true, url: parsed.href};
};

/**
 * The host, for naming a report after the page it audited.
 *
 * Falls back to the whole string rather than throwing: this renders a URL the
 * SERVER accepted, and a heading is no place to discover that the two disagree
 * about what parses.
 */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
