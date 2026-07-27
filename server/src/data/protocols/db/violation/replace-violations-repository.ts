import type { AddViolationParams } from './violation-params.js'

export interface ReplaceViolationsRepository {
  /**
   * Replaces every violation for an audit, atomically.
   *
   * Idempotent by construction, which matters because a queue redelivers: with
   * a plain insert, a retry after a partially-persisted result would add the
   * same rules a second time and inflate every count derived from them. There
   * is no uniqueness constraint on `violations` to catch that, so the write
   * itself has to be safe to repeat.
   *
   * This deliberately replaces the earlier append-only `addMany`: a second
   * write path that is not safe to repeat is a trap, not a convenience.
   */
  replaceAll: (auditId: string, violations: AddViolationParams[]) => Promise<void>
}
