import type {AuditModel} from '../../../../domain/models/audit.js';

export type AddOnDemandAuditParams = {
  userId: string;
  pageId: string;
  /** The UTC calendar day the allowance is counted in, as `YYYY-MM-DD`. */
  day: string;
  /** How many the account may have in the window. */
  allowance: number;
};

/**
 * One call rather than a load, a count and an insert, because the three have to
 * agree with each other and a caller cannot make them.
 *
 * Under READ COMMITTED a plain select takes no row lock, so two requests
 * arriving together both count the same zero audits and both insert - which is
 * the whole allowance spent twice, and two Chromium runs charged to an account
 * entitled to one. The implementation serialises; the shape here is what stops
 * a caller reintroducing the gap by doing the steps itself.
 */
export type AddOnDemandAuditResult =
  | {outcome: 'added'; audit: AuditModel}
  | {outcome: 'not-found'}
  | {outcome: 'in-flight'}
  | {outcome: 'allowance-spent'};

export interface AddOnDemandAuditRepository {
  addOnDemand: (params: AddOnDemandAuditParams) => Promise<AddOnDemandAuditResult>;
}

/**
 * Undoes an accepted request that never reached the queue: the audit row and
 * the allowance it spent, together.
 *
 * Together because they were written together. Removing only the audit leaves
 * the account charged for a run nothing will perform, which is the one outcome
 * a failed enqueue must not have.
 */
export interface ReleaseOnDemandAuditRepository {
  releaseOnDemand: (auditId: string) => Promise<void>;
}
