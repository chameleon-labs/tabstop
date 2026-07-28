export interface DeleteQueuedAuditRepository {
  /**
   * Removes an audit only while it is still `queued`.
   *
   * This exists for one caller: the submission path undoing a row whose
   * enqueue failed. That row was acknowledged to nobody, so removing it
   * strands nothing. Anything further along is somebody's real audit, and the
   * status predicate is what makes it untouchable through this path.
   */
  deleteIfQueued: (auditId: string) => Promise<void>
}
