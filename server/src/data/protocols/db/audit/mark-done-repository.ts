import type { CountsByImpact } from '../../../../domain/models/impact.js'

export type MarkDoneParams = {
  countsByImpact: CountsByImpact
  axeVersion: string
  durationMs: number
  /** False when the page never finished loading and was audited anyway. */
  settled: boolean
}

export interface MarkDoneRepository {
  /**
   * Deliberately takes no score: scoring is #6, and this worker stores raw
   * violations. `audits.score` stays null until that lands.
   *
   * Fenced on the claim token. An attempt that paused past its lease can
   * resume after another worker has reclaimed and finished the audit, and an
   * unfenced write would then overwrite the new owner's result with a stale
   * one. A write from an attempt that no longer owns the audit is dropped -
   * correctly, because the owner's result is the authoritative one.
   */
  markDone: (auditId: string, claimedAt: Date, result: MarkDoneParams) => Promise<void>
}
