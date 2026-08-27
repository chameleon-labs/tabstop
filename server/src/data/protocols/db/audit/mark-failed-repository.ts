export interface MarkFailedRepository {
  markFailed: (auditId: string, claimedAt: Date, error: string) => Promise<void>;
}
