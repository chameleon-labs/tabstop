/**
 * How a frame boundary is shown in a selector path.
 *
 * axe returns `target` as an array whose entries are FRAME boundaries: for an
 * element inside an iframe it is `['iframe#embed', '#inside']`, meaning "in
 * that frame, this element". Joining those with a space produces
 * `iframe#embed #inside`, which is a perfectly valid descendant selector for a
 * completely different element - one that almost certainly does not exist. It
 * looks right, and it is wrong in a way nobody would question.
 *
 * Shadow DOM does not come through here: the server flattens those with axe's
 * own ` >>> ` piercing notation before the array reaches us, so every entry
 * that survives is a frame.
 */
export const FRAME_SEPARATOR = ' » '

export const describeTarget = (target: readonly string[]): string =>
  target.join(FRAME_SEPARATOR)

/** True when the element is inside at least one frame, so the path can say so. */
export const crossesFrames = (target: readonly string[]): boolean => target.length > 1

/**
 * The one host axe builds rule documentation links on.
 *
 * The vendored engine carries `helpUrlBase: "https://dequeuniversity.com/rules/"`
 * and every rule's `helpUrl` is built from it, so this is a fact about the
 * bundle rather than a guess.
 *
 * Compared as an ORIGIN, not a hostname. `https://dequeuniversity.com:8443/`
 * shares the host and is a different origin, and an earlier version checking
 * protocol plus hostname accepted it while the comment beside it claimed the
 * exact origin was allowlisted. A subdomain wildcard is likewise refused:
 * it would admit anything Deque ever delegates, and there is no reason to.
 */
export const HELP_ORIGIN = 'https://dequeuniversity.com'

/**
 * The help link, if it can be trusted enough to render as one.
 *
 * DEFENCE IN DEPTH. `runAxeInPage` applies the same rule at the server
 * boundary, so a value reaching this function has already been filtered once -
 * this is the second guard, not the only one, and it exists because the two
 * ends can be deployed independently and a stored value predates any fix.
 *
 * Why it is not enough to check the scheme. `helpUrl` LOOKS like our data and
 * is not: it comes from `window.axe` inside the audited page, and the audited
 * page can replace that object before the engine is asked to run - this product
 * exists to visit pages nobody vetted. React blocks a `javascript:` href on its
 * own, so script execution is already prevented, and an earlier version of this
 * function stopped there. But `https://evil.example/phish` passes a scheme
 * check perfectly, and what it buys an attacker is a link reading "How to fix
 * this", inside an accessibility report, on a share page (#23) that anybody can
 * send to a colleague. The scheme was never the dangerous part; the origin was.
 *
 * Matching the HOST rather than reconstructing the URL from `ruleId` and the
 * axe version, deliberately: reconstruction hardcodes Deque's path structure,
 * which is theirs to change between releases, where the origin is stable. A
 * rule whose link fails this renders as no link at all, and the rule id is
 * still shown - the finding survives, only the convenience is lost.
 */
export const safeHelpUrl = (helpUrl: string): string | null => {
  let parsed: URL
  try {
    parsed = new URL(helpUrl)
  } catch {
    return null
  }

  return parsed.origin === HELP_ORIGIN ? parsed.href : null
}
