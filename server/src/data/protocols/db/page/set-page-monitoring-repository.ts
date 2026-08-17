import type {PageModel} from '../../../../domain/models/page.js';

export interface SetPageMonitoringRepository {
  /**
   * Both ids, always. There is deliberately no `setMonitoring(pageId, ...)` on
   * this repository to reach for by accident: the ownership check is not a
   * step a caller can forget, it is the only way to name a row.
   *
   * Pausing also cancels the audits the nightly run has scheduled for this page
   * and not yet started, in the same transaction. The two cannot come apart: a
   * pause that committed on its own would leave the page paused with an audit
   * still queued to run, and nothing in the worker path re-checks monitoring.
   * A page's first audit is left alone - it runs at once rather than behind a
   * jitter delay, so there is no window in which cancelling it helps anybody.
   *
   * Null when this account has no such page, including a malformed id.
   */
  setMonitoringForUser: (pageId: string, userId: string, monitoringEnabled: boolean) => Promise<PageModel | null>;
}
