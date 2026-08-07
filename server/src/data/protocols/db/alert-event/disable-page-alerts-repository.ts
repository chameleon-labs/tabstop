export interface DisablePageAlertsRepository {
  /** Idempotent for an existing page; false only when the page no longer exists. */
  disablePageAlerts: (pageId: string) => Promise<boolean>;
}
