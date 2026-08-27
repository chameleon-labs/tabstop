export interface MarkAlertEmailedRepository {
  markAlertEmailed: (alertEventId: string, emailedAt: Date) => Promise<boolean>;
}
