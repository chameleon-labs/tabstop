export interface MarkAlertEmailedRepository {
  /**
   * Conditional on emailed_at still being null. False means another worker
   * already recorded the same provider-confirmed send.
   */
  markAlertEmailed: (alertEventId: string, emailedAt: Date) => Promise<boolean>;
}
