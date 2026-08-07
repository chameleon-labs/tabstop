export interface MarkRunningRepository {
  /**
   * Atomically claims an audit for this attempt, returning a claim token - or
   * null when it could not be claimed.
   *
   * A conditional update rather than a read-then-write: a queue redelivers,
   * and between loading a row and marking it running another delivery can
   * finish the same audit, at which point a plain update would resurrect a
   * terminal audit and let a later run overwrite its result.
   *
   * A `running` audit is claimable only once its claim has gone stale. Status
   * alone cannot tell "another worker is running this right now" from "a
   * worker died and left it here", and those need opposite answers - so the
   * claim carries a lease, and a live one excludes every other delivery.
   */
  claimForRun: (auditId: string) => Promise<Date | null>;

  /**
   * Hands a claimed audit back so the next attempt can take it, without
   * marking it finished.
   *
   * Required because a retryable failure writes no terminal status: the row
   * would otherwise sit in `running` holding a live lease, and the queue's
   * retry - which arrives seconds later, far inside that lease - would fail to
   * claim it, return as though there were nothing to do, and strand the audit
   * in `running` for good.
   *
   * Fenced on the claim token so an attempt that has already been superseded
   * cannot release a claim it no longer owns.
   */
  releaseClaim: (auditId: string, claimedAt: Date) => Promise<void>;
}
