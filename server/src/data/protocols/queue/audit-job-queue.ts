export type AuditJob = {auditId: string};

export type EnqueueOptions = {delayMs: number};

export interface AuditJobQueue {
  enqueueOnce: (job: AuditJob, options?: EnqueueOptions) => Promise<void>;
  has: (auditId: string) => Promise<boolean>;
  isPending: (auditId: string) => Promise<boolean>;
  backlogCount: () => Promise<number>;
}
