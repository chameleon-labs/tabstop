import { EXPECTED_DURATION } from '../../audit/phase'

export type AuditProgressProps = {
  /** From `useAuditPhase`. Null when there is nothing in flight to describe. */
  phase: string | null
}

/**
 * What a person sees for the thirty seconds an audit takes.
 *
 * Two things do more than any animation: naming what is happening, and saying
 * how long it takes. Both are here, and the duration sits in the same sentence
 * as the phase - mentioned once at the top, it is gone by the time anyone
 * starts wondering.
 *
 * THIS OWNS NO LIVE REGION, and the reason is worth keeping. Merging the region
 * into this sentence avoided saying the same thing twice, and solved
 * re-announcement for free: React does not touch the DOM when a rendered string
 * is unchanged, so a phase holding for ten ticks produced no mutation. But it
 * broke a rule written down in `RouteAnnouncer` - a region mounted with content
 * already in it is initial content, and initial content is announced by
 * nothing. The FIRST phase was therefore never spoken, which is the one this
 * screen most needs.
 *
 * `AuditAnnouncer` owns the region now: mounted empty by the screen before this
 * appears, and still mounted after it goes, which is what makes completion
 * announceable at all.
 */
export const AuditProgress = ({ phase }: AuditProgressProps): React.JSX.Element | null => {
  if (phase === null) return null

  return (
    <section aria-labelledby="audit-progress-heading">
      <h2 id="audit-progress-heading">Auditing</h2>
      <p>{phase}… {EXPECTED_DURATION}</p>
    </section>
  )
}
