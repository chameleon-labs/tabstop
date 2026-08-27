import type {AuditSnapshot} from '../../../../domain/services/regression.js';
import type {CountsByImpact} from '../../../../domain/models/impact.js';

export type CompleteAuditParams = {
  score: number;
  countsByImpact: CountsByImpact;
  axeVersion: string;
  durationMs: number;
  settled: boolean;
  violations: AuditSnapshot['violations'];
};

export interface CompleteAuditRepository {
  complete: (auditId: string, claimedAt: Date, result: CompleteAuditParams) => Promise<void>;
}
