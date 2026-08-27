import type {AuditModel} from '../models/audit.js';
import type {ViolationModel} from '../models/violation.js';

export type AuditResult = {
  audit: AuditModel;
  violations: ViolationModel[];
};

export interface LoadAuditResult {
  load: (publicUuid: string) => Promise<AuditResult | null>;
}
