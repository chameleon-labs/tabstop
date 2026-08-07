import type {AuditSnapshot} from '../../../../domain/services/regression.js';
import type {CountsByImpact} from '../../../../domain/models/impact.js';

export type CompleteAuditParams = {
  /** Integer in [0, 100]. See `domain/services/score.ts` for the formula. */
  score: number;
  countsByImpact: CountsByImpact;
  axeVersion: string;
  durationMs: number;
  /** False when the page never finished loading and was audited anyway. */
  settled: boolean;
  /** Rule-level snapshot from the result whose violations were just stored. */
  violations: AuditSnapshot['violations'];
};

export interface CompleteAuditRepository {
  /**
   * Atomically marks the claimed audit done and records any regression.
   *
   * The completion fence and alert insert share a transaction so a committed
   * `done` row can never be left without the alert it warranted.
   */
  complete: (auditId: string, claimedAt: Date, result: CompleteAuditParams) => Promise<void>;
}
