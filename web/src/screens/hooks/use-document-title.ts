import { useEffect } from 'react'
import { documentTitleSet } from '@/a11y/announce'

/** What every title is suffixed with, and what an empty title falls back to. */
export const SITE_NAME = 'tabstop'

/**
 * Names the document for the tab, the history entry and - through
 * `RouteAnnouncer` - the screen reader. One call per screen.
 *
 * Lives here rather than beside `RouteAnnouncer` because it is a hook, not a
 * component, and every screen imports it while only the shell renders the
 * announcer. The coupling runs the other way: the announcer reads whatever this
 * set, so the tab and the announcement cannot disagree.
 *
 * An empty title means "the site itself", which is the home screen - the
 * alternative, `· tabstop` with nothing in front of it, reads as a bug.
 */
export const useDocumentTitle = (title: string): void => {
  // No dependency array, deliberately. Keyed on `title`, this does not re-run
  // when a screen stays mounted across a navigation that keeps the same name -
  // `/pages/1` and `/pages/2` are both "Page" - and the announcer would then
  // wait for a signal that never came. Writing the same string to
  // `document.title` is idempotent, and the announcer takes only the first
  // signal after each navigation.
  useEffect(() => {
    document.title = title === '' ? SITE_NAME : `${title} · ${SITE_NAME}`
    documentTitleSet()
  })
}
