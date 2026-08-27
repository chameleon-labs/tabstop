import type {AddViolationParams} from './violation-params.js';

export interface ReplaceViolationsRepository {
  replaceAll: (auditId: string, claimedAt: Date, violations: AddViolationParams[]) => Promise<void>;
}
