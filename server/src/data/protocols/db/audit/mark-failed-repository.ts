export interface MarkFailedRepository {
  /**
   * `error` is a message written for the user, never a stack trace.
   *
   * Fenced on the claim token, like complete: without it a timed-out final
   * attempt could resume after another worker had already completed the audit
   * and turn that successful row into a failure.
   */
  markFailed: (auditId: string, claimedAt: Date, error: string) => Promise<void>;
}
