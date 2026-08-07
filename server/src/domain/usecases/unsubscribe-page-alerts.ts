export interface UnsubscribePageAlerts {
  /** False for a malformed token or a page that no longer exists. */
  unsubscribe: (token: string) => Promise<boolean>;
}
