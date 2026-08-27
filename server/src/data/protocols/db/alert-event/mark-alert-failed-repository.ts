export interface MarkAlertFailedRepository {
  markAlertFailed: (alertEventId: string, failedAt: Date, failureReason: string) => Promise<boolean>;
}
