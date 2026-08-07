/**
 * What one nightly run did, in the terms an operator needs.
 *
 * A scheduler that stops firing degrades this product invisibly: nothing
 * errors, users simply stop being told their pages got worse. So the run
 * reports itself even when it finds nothing to do - a summary that appears only
 * when there is work is one nobody notices the absence of.
 */
export type ReauditRunSummary = {
  /** The UTC day this run is for, as `YYYY-MM-DD`. */
  scheduledFor: string;
  /** Pages the eligibility query returned. */
  pagesConsidered: number;
  auditsEnqueued: number;
  /**
   * Pages another run had already scheduled for this day, refused by the unique
   * index rather than the query. Non-zero is the second idempotency layer
   * working; persistently non-zero means something fires twice.
   */
  skippedDuplicate: number;
  /**
   * Pages whose audit could not be created or queued.
   *
   * The run tries to remove a row whose job never reached the queue and does
   * not retry - the outage that failed the delete fails the retry - so a page
   * counted here sometimes leaves an unfinished row for the reclaim pass.
   */
  failed: number;
  /**
   * Unfinished audits retired because the queue no longer held their job.
   *
   * Expected to be zero. Each one silently blocked a page's monitoring, so a
   * climbing number means enqueues are being lost.
   */
  abandonedReclaimed: number;
  /**
   * Reclaim attempts that could not be carried out at all.
   *
   * Separate from `abandonedReclaimed` because nothing-owed and nothing-worked
   * are opposite facts and only the first is good news. While reclaiming keeps
   * failing, stranded rows keep excluding their pages and every other number
   * here still looks healthy.
   */
  reclaimFailures: number;
  /**
   * Whether the run stopped with pages still due - circuit breaker, or asked to
   * shut down. Normally false however many pages there are, since the run pages
   * through the whole worklist.
   */
  truncated: boolean;
};

export type RunScheduledReauditsOptions = {
  /**
   * Stops the run at its next page.
   *
   * A full fan-out outlasts a worker's shutdown grace, so without this a deploy
   * mid-run force-exits - possibly between creating an audit row and queueing
   * its job. Stopping cleanly just leaves pages unscheduled for the next run.
   */
  signal?: AbortSignal;
  /**
   * Called with the summary so far, after the reclaim pass and every batch.
   *
   * For reporting a run that never returned. One interrupted partway has
   * already scheduled real audits, and its counters are the only record of how
   * many; without this they go with the exception and no log reconstructs the
   * night.
   */
  report?: (summary: ReauditRunSummary) => void;
};

export interface RunScheduledReaudits {
  /**
   * `now` is passed rather than read, so the UTC day this run belongs to is
   * decided once and shared by every row of the run.
   */
  run: (now: Date, options?: RunScheduledReauditsOptions) => Promise<ReauditRunSummary>;
}
