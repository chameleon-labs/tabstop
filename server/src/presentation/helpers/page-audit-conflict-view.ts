import type {OnDemandAuditSpentBody, PageAuditConflictCode} from '@tabstop/contract';

export const PAGE_AUDIT_CONFLICT: Record<'inFlight' | 'allowanceSpent', PageAuditConflictCode> = {
  inFlight: 'audit_in_flight',
  allowanceSpent: 'on_demand_audit_spent',
};

export const allowanceResetDetails = (resetAt: Date): Pick<OnDemandAuditSpentBody, 'resetAt'> => ({
  resetAt: resetAt.toISOString(),
});
