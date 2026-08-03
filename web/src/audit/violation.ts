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
 * The help link, if it can be trusted enough to render as one.
 *
 * `helpUrl` LOOKS like our data and is not. It comes from `window.axe` inside
 * the audited page, and the audited page can replace that object before the
 * engine is asked to run - this product exists to visit pages nobody vetted.
 * The server currently passes the field through without checking it.
 *
 * React blocks a `javascript:` href on its own, so the immediate script
 * execution is already prevented. What it does not prevent is `data:` and
 * arbitrary remote origins: a link reading "How to fix this", inside an
 * accessibility report, pointing wherever an audited site chose. That is a
 * phishing primitive with our UI as the frame, and the share page (#23) makes
 * it one anybody can send to a colleague.
 *
 * So only `http:` and `https:` survive, and anything else renders as no link at
 * all rather than as a link somewhere unexpected.
 */
export const safeHelpUrl = (helpUrl: string): string | null => {
  let parsed: URL
  try {
    parsed = new URL(helpUrl)
  } catch {
    return null
  }

  return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
}
