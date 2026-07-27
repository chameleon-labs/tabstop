export interface MarkRunningRepository {
  /**
   * Atomically claims an audit for this attempt, returning false when it was
   * already finished.
   *
   * A conditional update rather than a read-then-write: a queue redelivers,
   * and between loading a row and marking it running another delivery can
   * finish the same audit - at which point a plain update would resurrect a
   * terminal audit back into `running` and its result would be overwritten by
   * a second, later run.
   *
   * Claiming from `running` is deliberate: a worker that died mid-audit leaves
   * the row there, and that attempt must be retryable.
   */
  claimForRun: (auditId: string) => Promise<boolean>
}
