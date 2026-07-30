/**
 * What one nightly run did, in the terms an operator needs.
 *
 * A scheduler that stops firing degrades this product invisibly: nothing
 * errors, no request fails, users simply stop being told their pages got
 * worse. So the run reports itself even when it finds nothing to do - a
 * summary that only appears when there is work is one nobody notices the
 * absence of.
 */
export type ReauditRunSummary = {
  /** The UTC day this run is for, as `YYYY-MM-DD`. */
  scheduledFor: string
  /** Pages the eligibility query returned. */
  pagesConsidered: number
  auditsEnqueued: number
  /**
   * Pages another run had already scheduled for this day, refused by the
   * unique index rather than by the query. Non-zero means two runs overlapped,
   * which is not an error - it is the second idempotency layer doing its job -
   * but a number that stays non-zero means something is firing twice.
   */
  skippedDuplicate: number
  /** Pages whose audit could not be created or queued. Their rows are removed. */
  failed: number
  /**
   * Unfinished audits retired because the queue no longer held their job.
   *
   * Expected to be zero. A row like that is one a page's monitoring was
   * silently stuck behind, so a number that keeps climbing means enqueues are
   * being lost - which is worth knowing well before anyone notices their
   * pages have stopped being checked.
   */
  abandonedReclaimed: number
  /**
   * Reclaim attempts that could not be carried out at all.
   *
   * Separate from `abandonedReclaimed` because zero-because-nothing-was-owed
   * and zero-because-nothing-worked are opposite facts, and only the first is
   * good news. While reclaiming keeps failing, stranded rows keep excluding
   * their pages and every other number here looks healthy - which is exactly
   * the invisible degradation this pass was added to prevent.
   */
  reclaimFailures: number
  /**
   * Whether the run stopped with pages still due - because it hit its circuit
   * breaker, or because it was asked to shut down.
   *
   * Normally false however many pages there are: the run pages through the
   * whole worklist.
   */
  truncated: boolean
}

export interface RunScheduledReaudits {
  /**
   * `now` is passed rather than read, so the UTC day this run belongs to is a
   * decision the caller makes once and every row of the run shares.
   *
   * `signal` stops the run at the next page. A full fan-out takes far longer
   * than a worker's shutdown grace, so without it a deploy during the run is a
   * force-exit - which can land between creating an audit row and queueing its
   * job. Stopping cleanly leaves the remaining pages simply unscheduled, which
   * is what the next run is for.
   */
  run: (now: Date, signal?: AbortSignal) => Promise<ReauditRunSummary>
}
