import type {AuditJobQueue} from '../../data/protocols/queue/audit-job-queue.js';

export class TestAuditJobQueue implements AuditJobQueue {
  readonly jobs = new Map<string, {auditId: string; delayMs?: number}>();

  async enqueueOnce(job: {auditId: string}, options?: {delayMs: number}): Promise<void> {
    if (!this.jobs.has(job.auditId)) {
      const queued: {auditId: string; delayMs?: number} = {auditId: job.auditId};
      if (options?.delayMs !== undefined) queued.delayMs = options.delayMs;
      this.jobs.set(job.auditId, queued);
    }
  }

  async has(auditId: string): Promise<boolean> {
    return this.jobs.has(auditId);
  }

  async isPending(auditId: string): Promise<boolean> {
    return this.jobs.has(auditId);
  }

  async backlogCount(): Promise<number> {
    return this.jobs.size;
  }
}
