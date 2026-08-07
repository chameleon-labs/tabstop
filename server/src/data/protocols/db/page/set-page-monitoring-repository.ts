import type {PageModel} from '../../../../domain/models/page.js';

export interface SetPageMonitoringRepository {
  /**
   * Both ids, always. There is deliberately no `setMonitoring(pageId, ...)` on
   * this repository to reach for by accident: the ownership check is not a
   * step a caller can forget, it is the only way to name a row.
   *
   * Null when this account has no such page, including a malformed id.
   */
  setMonitoringForUser: (pageId: string, userId: string, monitoringEnabled: boolean) => Promise<PageModel | null>;
}
