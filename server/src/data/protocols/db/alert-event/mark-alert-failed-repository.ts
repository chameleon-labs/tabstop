export interface MarkAlertFailedRepository {
  /**
   * Conditional on the alert not already reaching a terminal delivery state.
   * False means another worker won the race.
   */
  markAlertFailed: (alertEventId: string, failedAt: Date, failureReason: string) => Promise<boolean>;
}
