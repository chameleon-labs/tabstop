export interface MarkRunningRepository {
  markRunning: (auditId: string) => Promise<void>
}
