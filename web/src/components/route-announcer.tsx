import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

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
    const timer = setTimeout(() => { setAnnouncement(document.title) }, 100)
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

/**
 * Names the document for the tab, the history entry and - through
 * `RouteAnnouncer` - the screen reader. One call per screen.
 */
export const useDocumentTitle = (title: string): void => {
  useEffect(() => {
    document.title = title === '' ? 'tabstop' : `${title} · tabstop`
  }, [title])
}
