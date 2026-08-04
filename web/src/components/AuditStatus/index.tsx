import { useEffect, useState } from 'react'
import { ANNOUNCE_DELAY_MS } from '../../a11y/announce'

export type AuditStatusProps = {
  /** Null while there is nothing to say. */
  message: string | null
}

/**
 * The single status line for an audit, from before it starts until after it
 * finishes. Visible, and the live region.
 *
 * ONE NODE, and getting here took four attempts worth recording, because each
 * fix broke the next requirement:
 *
 * 1. the visible sentence WAS the region - but it mounted with its first phase
 *    already in it, and content present when a region appears is initial
 *    content, announced by nothing;
 * 2. so a hidden region was added beside it - which announced the same sentence
 *    the visible text already carried, so a screen reader met it twice;
 * 3. and the hidden one was written from an effect - which can run before the
 *    browser exposes the empty node, losing the first message anyway.
 *
 * All three requirements are satisfiable by one element, provided it is
 * ALWAYS MOUNTED and written to LATE. It lives above the conditional sections
 * rather than inside them, so it exists before the first audit is submitted and
 * still exists when the result replaces the progress indicator - which is what
 * makes completion announceable at all. Nothing else says anything then: the
 * route has not changed, so the route announcer is silent.
 *
 * `polite`, because none of this should interrupt. Only a failure is urgent,
 * and `AuditFailure` is a `role="alert"` of its own.
 */
export const AuditStatus = ({ message }: AuditStatusProps): React.JSX.Element => {
  const [shown, setShown] = useState('')

  useEffect(() => {
    // Only on change, so the region mutates once per thing worth saying rather
    // than once per render - the screen re-renders every second while an audit
    // runs, and thirty announcements for one audit is unusable.
    if (message === null || message === shown) return

    // Deferred rather than written here. A passive effect can run before the
    // browser has painted or exposed the node, so an immediate write can still
    // arrive as initial content.
    const timer = setTimeout(() => { setShown(message) }, ANNOUNCE_DELAY_MS)
    return () => { clearTimeout(timer) }
  }, [message, shown])

  return (
    <p role="status" aria-live="polite" aria-atomic="true">{shown}</p>
  )
}
