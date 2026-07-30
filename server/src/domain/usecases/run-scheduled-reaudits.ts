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
   * Whether the run hit its circuit breaker with pages still due.
   *
   * Normally false however many pages there are: the run pages through the
   * whole worklist. True means something is wrong with the eligibility
   * predicate rather than that the product got popular, so it is an alert.
   */
  truncated: boolean
}

export interface RunScheduledReaudits {
  /**
   * `now` is passed rather than read, so the UTC day this run belongs to is a
   * decision the caller makes once and every row of the run shares.
   */
  run: (now: Date) => Promise<ReauditRunSummary>
}
