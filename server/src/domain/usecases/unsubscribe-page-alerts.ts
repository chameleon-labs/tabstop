export interface UnsubscribePageAlerts {
  unsubscribe: (token: string) => Promise<boolean>;
}
