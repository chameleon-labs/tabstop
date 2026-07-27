export interface MarkFailedRepository {
  /** `error` is a message written for the user, never a stack trace. */
  markFailed: (auditId: string, error: string) => Promise<void>
}
