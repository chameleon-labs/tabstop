import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { ANNOUNCE_DELAY_MS, onDocumentTitleSet } from '../../a11y/announce'

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
     * Waits for the incoming screen to name itself, rather than guessing when
     * it will. `useDocumentTitle` signals; until it does there is nothing
     * truthful to announce, and announcing on a timer named the page being
     * LEFT whenever a screen was slower than the timer.
     *
     * The deferral is still needed once the signal arrives: a live region has
     * to be in the DOM and empty before text lands in it, or the content counts
     * as initial content and assistive technology stays quiet.
     *
     * Exactly one announcement per navigation. An earlier version announced on
     * schedule and corrected afterwards, which fixed the final text and left a
     * screen reader hearing both.
     */
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = onDocumentTitleSet(() => {
      stop()
      timer = setTimeout(() => { setAnnouncement(document.title) }, ANNOUNCE_DELAY_MS)
    })

    return () => {
      stop()
      clearTimeout(timer)
    }
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
