export interface DeleteQueuedAuditRepository {
  deleteIfQueued: (auditId: string) => Promise<void>;
}
