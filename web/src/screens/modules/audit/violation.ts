/**
 * How a frame boundary is shown in a selector path.
 *
 * axe's `target` entries are frame boundaries: `['iframe#embed', '#inside']`
 * means "in that frame, this element". Joined with a space it becomes a valid
 * descendant selector for a different element that does not exist. Shadow DOM
 * never reaches here - the server flattens it with axe's ` >>> ` notation.
 */
export const FRAME_SEPARATOR = ' » '

export const describeTarget = (target: readonly string[]): string =>
  target.join(FRAME_SEPARATOR)

/** True when the element is inside at least one frame, so the path can say so. */
export const crossesFrames = (target: readonly string[]): boolean => target.length > 1

/**
 * The one host axe builds rule documentation links on.
 *
 * Compared as an ORIGIN rather than a hostname: `https://dequeuniversity.com:8443`
 * shares the host and is a different origin.
 */
export const HELP_ORIGIN = 'https://dequeuniversity.com'

/**
 * The help link, if its origin can be trusted.
 *
 * `helpUrl` comes from `window.axe` inside the audited page, and that page can
 * replace the object before the engine runs. A scheme check is not enough:
 * `https://evil.example/phish` passes one, and buys a link reading "How to fix
 * this" inside a report anyone can share (#23).
 *
 * Defence in depth - `runAxeInPage` applies the same rule at the server
 * boundary, and the two ends deploy independently. A rule that fails renders
 * as no link, with the rule id still shown.
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
