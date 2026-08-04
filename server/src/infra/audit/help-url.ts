/**
 * The single origin axe builds rule documentation links on.
 *
 * The vendored engine carries `helpUrlBase: "https://dequeuniversity.com/rules/"`
 * and every rule's `helpUrl` is derived from it, so this is a fact about the
 * bundle rather than a guess. Compared as an ORIGIN rather than a hostname:
 * `https://dequeuniversity.com:8443/` shares the host and is a different
 * origin, and "the exact origin" is what the rule is supposed to be.
 */
export const HELP_ORIGIN = 'https://dequeuniversity.com'

/**
 * A rule's documentation link, or '' if the audited page did not hand back one.
 *
 * RUNS IN NODE, and that is the entire point of this file existing.
 *
 * This check lived inside `runAxeInPage` first, which was wrong in a way worth
 * recording: that function is serialised into the audited page by
 * `page.evaluate` and runs in the page's own realm. A page hostile enough to
 * replace `window.axe` - which is the threat the check exists for - can replace
 * `window.URL` just as easily, with a parser that reports whatever origin makes
 * its link pass. Validation performed with the attacker's own globals is not
 * validation. It has to happen after the result crosses back into Node, where
 * `URL` is ours.
 *
 * EVERYTHING IN THE AXE RESULT IS ATTACKER-CONTROLLED, `helpUrl` included: it
 * is a string the audited site chose. Stored and served verbatim it becomes the
 * `href` of a link reading "How to fix this" inside an accessibility report,
 * and the share page makes that one anybody can send to a colleague. The origin
 * is what matters rather than the scheme - `https://evil.example/phish` passes
 * any scheme test - because phishing from inside our own report is the risk.
 *
 * Dropped to '' rather than nulled because the column and the wire field are
 * both non-nullable, and this is a sanitiser rather than a migration. Clients
 * treat '' as "no link" and apply the same rule again: this is the boundary,
 * not the only guard.
 */
export const safeHelpUrl = (helpUrl: unknown): string => {
  if (typeof helpUrl !== 'string') return ''

  try {
    const parsed = new URL(helpUrl)
    return parsed.origin === HELP_ORIGIN ? parsed.href : ''
  } catch {
    return ''
  }
}
