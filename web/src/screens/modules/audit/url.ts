/**
 * What the input box does to what someone typed, before it is submitted.
 *
 * THE CLIENT IS FORGIVING, NOT AUTHORITATIVE. It rejects only what it can judge
 * without knowing any policy - nothing typed at all, and something that is not
 * a URL in any reading. Everything else goes to the server, which owns the
 * rules and the sentences that explain them: blocked schemes, blocked ports,
 * private addresses, embedded credentials.
 *
 * That division is deliberate rather than lazy. `REJECTION_MESSAGES` on the
 * server carries a comment about why there must be exactly one copy of that
 * table - a submission-time rejection and an audit-time one have to read
 * identically, or the difference tells an attacker which internal addresses
 * exist. A second copy over here would erode that guarantee from a package the
 * server cannot see. The cost is one round trip for `ftp://…`, which nobody
 * types twice.
 */
export type UrlProblem = 'empty' | 'unparseable'

export type UrlInput =
  | { ok: true, url: string }
  | { ok: false, problem: UrlProblem }

/**
 * Messages for the two cases the server never sees, so they are ours to write.
 * Anything else is quoted from the response.
 */
export const URL_PROBLEMS: Readonly<Record<UrlProblem, string>> = {
  empty: 'Enter a URL to audit',
  unparseable: 'That does not look like a URL'
}

/**
 * `example.com:8080` and `mailto:someone@example.com` are THE SAME SYNTAX.
 *
 * A scheme is `[a-z][a-z0-9+.-]*:`, and a host with a port matches it exactly -
 * dots and hyphens are legal scheme characters. A single `HAS_SCHEME` test
 * therefore read `example.com:` as a scheme, left the input alone, and turned
 * every `host:port` into an unparseable URL. Found by a spec rather than by
 * inspection, which is the only reason this comment exists.
 *
 * What separates them is the character AFTER the colon:
 *
 * - `://` is hierarchical and unambiguous - `https://`, `ftp://`.
 * - a digit after the colon SUGGESTS a port, but only suggests it: `mailto:123`
 *   has one too, and reading that as a host called `mailto` on port 123
 *   rewrote it to `https://mailto:123/` - a real address, entirely unrelated to
 *   what was typed, submitted without a word. So the part before the colon must
 *   also look like a host: dotted, or `localhost`, which is the one dotless
 *   name anyone actually types with a port.
 * - anything else is an opaque scheme - `mailto:`, `javascript:` - left alone
 *   precisely so the host check below rejects it.
 *
 * `foo:123` remains genuinely ambiguous and is read as a scheme. That direction
 * is the safe one: it ends in "that does not look like a URL" rather than in
 * auditing a different site than the one asked for.
 */
const HIERARCHICAL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const HOST_AND_PORT = /^(?:localhost|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+):\d/i
const OPAQUE_SCHEME = /^[a-z][a-z0-9+.-]*:/i

const hasScheme = (input: string): boolean => {
  if (HIERARCHICAL_SCHEME.test(input)) return true
  if (HOST_AND_PORT.test(input)) return false
  return OPAQUE_SCHEME.test(input)
}

/**
 * `example.com` becomes `https://example.com/`.
 *
 * https rather than http when none is given, because a bare domain in 2026 is
 * https and guessing otherwise costs a redirect the audit would then follow.
 * An EXPLICIT `http://` is preserved rather than upgraded - someone who typed
 * it meant it, and silently auditing a different URL than the one shown back
 * would be worse than auditing the one they asked for.
 *
 * Returns the canonical `href`, which is also what gets displayed. Showing one
 * string and submitting another is how "why does it say example.com but the
 * result says example.com/" happens.
 */
export const normaliseUrl = (raw: string): UrlInput => {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, problem: 'empty' }

  const candidate = hasScheme(trimmed) ? trimmed : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, problem: 'unparseable' }
  }

  // `javascript:alert(1)` and `mailto:a@b.com` parse perfectly well and have no
  // host. Rejecting on the host rather than on a scheme allowlist keeps the
  // scheme policy in one place - the server's - while still refusing the two
  // forms that could never name a page.
  if (parsed.hostname === '') return { ok: false, problem: 'unparseable' }

  return { ok: true, url: parsed.href }
}
