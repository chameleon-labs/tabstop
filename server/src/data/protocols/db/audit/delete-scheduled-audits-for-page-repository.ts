export interface DeleteScheduledAuditsForPageRepository {
  /**
   * Removes the audits the nightly run scheduled for this page and that have
   * not started, and reports how many there were.
   *
   * Scoped three ways, and each one matters. By page, because pausing knows
   * which page it paused and not what the run scheduled for it. By `queued`,
   * because anything running or finished is somebody's real audit. And by
   * `scheduled_for`, because a page's FIRST audit is queued too - written when
   * the page was added, and enqueued to run at once rather than behind a jitter
   * delay. There is no window in which cancelling that one helps anybody, and
   * removing it would cost a new page its first score until the next night.
   */
  deleteScheduledForPage: (pageId: string) => Promise<number>;
}
