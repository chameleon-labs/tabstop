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
   */
  markDone: (auditId: string, result: MarkDoneParams) => Promise<void>
}
