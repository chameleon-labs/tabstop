export interface MarkRunningRepository {
  claimForRun: (auditId: string) => Promise<Date | null>;

  releaseClaim: (auditId: string, claimedAt: Date) => Promise<void>;
}
