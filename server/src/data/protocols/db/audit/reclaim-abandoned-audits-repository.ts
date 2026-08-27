export type StaleAudit = {
  auditId: string;
  createdAt: string;
};

export interface ReclaimAbandonedAuditsRepository {
  loadStaleInFlight: (olderThan: Date, limit: number, after: StaleAudit | null) => Promise<StaleAudit[]>;

  markAbandoned: (auditId: string, error: string) => Promise<boolean>;
}
