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
   * A `running` audit is claimable only once its claim has gone stale. Status
   * alone cannot tell "another worker is running this right now" from "a
   * worker died and left it here", and those need opposite answers - so the
   * claim carries a lease, and a live one excludes every other delivery.
   */
  claimForRun: (auditId: string) => Promise<boolean>
}
