export type RunAuditParams = {
  auditId: string;
  signal: AbortSignal;
  isFinalAttempt: boolean;
};

export interface RunAudit {
  run: (params: RunAuditParams) => Promise<void>;
}
