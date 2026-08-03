import { useEffect, useState } from 'react'

export type AuditAnnouncerProps = {
  /** Null while there is nothing new to say. */
  message: string | null
}

/**
 * The one live region for an audit's whole life, from submitted to finished.
 *
 * IT MOUNTS EMPTY, and that is the entire reason it exists as its own
 * component. A region whose text is present at the moment it appears is treated
 * as initial content and announced by nothing - a rule already written down in
 * `RouteAnnouncer`, and broken by `AuditProgress`, which mounted with its first
 * phase already in it. So "Requesting the audit" was never spoken; only later
 * phase changes were, because by then the region existed.
 *
 * It also outlives the progress indicator. The old region unmounted when the
 * audit finished, taking with it any chance to say so: the result appeared, the
 * route did not change so the route announcer stayed silent, and someone who
 * had waited thirty seconds for an answer got no indication it had arrived.
 * This one is still mounted at that moment, so completion is an announcement
 * rather than a surprise.
 *
 * `polite`, because none of this should interrupt. Only a failure is urgent,
 * and `AuditFailure` is a `role="alert"` of its own.
 *
 * IT DOES SAY THE SAME THING AS THE VISIBLE SENTENCE, and that duplication is
 * accepted rather than overlooked. An earlier version merged the two to avoid
 * it, which is why the region ended up mounting with content in it and never
 * announcing its first phase. The split is not a style choice: the announcement
 * has to exist BEFORE the progress indicator appears and AFTER it goes, and no
 * single node can both show progress and speak once progress is gone.
 *
 * `aria-hidden` on the visible sentence would remove the duplication, and is
 * rejected: someone arriving after an announcement could no longer read what
 * phase the audit is in. Hearing a sentence and being able to find it again is
 * the better trade.
 */
export const AuditAnnouncer = ({ message }: AuditAnnouncerProps): React.JSX.Element => {
  const [announced, setAnnounced] = useState('')

  useEffect(() => {
    // Set only on change, so the region mutates once per thing worth saying
    // rather than once per render - the progress indicator re-renders every
    // second, and thirty announcements for one audit is unusable.
    if (message === null || message === announced) return
    setAnnounced(message)
  }, [message, announced])

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="visually-hidden">
      {announced}
    </div>
  )
}
