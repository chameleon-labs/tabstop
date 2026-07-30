export interface ReclaimAbandonedAuditsRepository {
  /**
   * Ids of unfinished audits older than `olderThan`, oldest first.
   *
   * A candidate list, not a verdict. Age alone cannot tell an abandoned audit
   * from one waiting behind a long queue, so the caller confirms each against
   * the queue before touching it - the age is only what keeps the scan small.
   *
   * Oldest first because that is where the abandoned ones are: a row waiting
   * on a busy queue gets older every night, but so does everything ahead of
   * it, and the ones with no job at all never move.
   */
  loadStaleInFlight: (olderThan: Date, limit: number) => Promise<string[]>

  /**
   * Marks an unfinished audit as failed, and reports whether it did.
   *
   * `failed` rather than deleted, because the audit is a fact: the page was
   * due, a run was created for it, and nothing ever ran it. The dashboard
   * shows a failure rather than a run stuck in progress, and the trend chart
   * keeps it as a scoreless point - which is exactly what a night with no
   * result should look like.
   *
   * False when the row had already moved on, so a race cannot be counted as a
   * reclaim.
   */
  markAbandoned: (auditId: string, error: string) => Promise<boolean>
}
