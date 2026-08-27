export interface DisablePageAlertsRepository {
  disablePageAlerts: (pageId: string) => Promise<boolean>;
}
