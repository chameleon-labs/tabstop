import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

/**
 * How long to wait before reading `document.title`.
 *
 * Not a tuned number: it is short enough to be imperceptible and long enough
 * for the destination screen's own title effect to have run. Exported so a spec
 * can wait on the same value rather than guess a longer one.
 */
export const ANNOUNCE_DELAY_MS = 100

/**
 * Says the new page's name after a client-side navigation.
 *
 * A full page load announces the new document; a client-side route change
 * announces nothing at all, so a screen reader user activates a link and hears
 * silence. This is the standard repair, and it belongs in an accessibility
 * product's own shell rather than in a backlog.
 *
 * `document.title` is the source, set by `useDocumentTitle` on each screen, so
 * the announcement and the browser tab can never say different things.
 */
export const RouteAnnouncer = (): React.JSX.Element => {
  const { pathname } = useLocation()
  const [announcement, setAnnouncement] = useState('')

  /**
   * Seeded with the current path rather than a boolean, so the initial page is
   * never announced: the browser already did that, and repeating it is noise.
   *
   * A `firstRender` flag would not survive StrictMode, which mounts, unmounts
   * and remounts every effect in development - the flag would be spent on the
   * first pass and the second would announce the initial page anyway. Comparing
   * paths is idempotent, so a repeated effect is a no-op.
   */
  const announcedFor = useRef(pathname)

  useEffect(() => {
    if (announcedFor.current === pathname) return
    announcedFor.current = pathname

    /**
     * Emptied first, and this is not tidying.
     *
     * Two paths can share a title - `/pages/1` and `/pages/2` are both
     * "Page · tabstop" today. Setting the state to the string it already holds
     * is a no-op to React, so the DOM never changes, so a live region has
     * nothing new to read and the second navigation is announced by silence.
     * Clearing makes the next write a real mutation whatever the title says.
     */
    setAnnouncement('')

    /**
     * Deferred for two reasons, both required.
     *
     * The screen's `useDocumentTitle` has not run yet - this component is a
     * sibling that appears earlier in the tree, so its effect fires first, and
     * reading the title synchronously here would announce the PREVIOUS page.
     *
     * And the live region has to be in the DOM and empty before the text lands
     * in it; content present at the same moment the region appears is treated
     * as initial content, and assistive technology stays quiet.
     */
    const timer = setTimeout(() => { setAnnouncement(document.title) }, ANNOUNCE_DELAY_MS)
    return () => { clearTimeout(timer) }
  }, [pathname])

  return (
    // `role="status"` is the polite live region, and unlike a bare `aria-live`
    // div it is addressable - a test can ask for it by role rather than by a
    // class name that says nothing about behaviour.
    <div role="status" aria-live="polite" aria-atomic="true" className="visually-hidden">
      {announcement}
    </div>
  )
}
