import type {OnDemandAuditSpentBody, PageAuditConflictCode} from '@tabstop/contract';

/**
 * The discriminants and extra data of the two 409s `POST /api/pages/:id/audits`
 * answers with, pinned to the published union.
 *
 * The client branches on these - "already running" wants the progress it is
 * about to see anyway, "spent" wants a time - so they are a contract rather
 * than an implementation detail, and this is the file that fails the build when
 * either side moves. Same reasoning as `page-conflict-view.ts`.
 */
export const PAGE_AUDIT_CONFLICT: Record<'inFlight' | 'allowanceSpent', PageAuditConflictCode> = {
  inFlight: 'audit_in_flight',
  allowanceSpent: 'on_demand_audit_spent',
};

/** The one variant that carries data beyond the sentence. */
export const allowanceResetDetails = (resetAt: Date): Pick<OnDemandAuditSpentBody, 'resetAt'> => ({
  resetAt: resetAt.toISOString(),
});
