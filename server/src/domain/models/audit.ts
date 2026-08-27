import type {CountsByImpact} from './impact.js';

export type AuditStatus = 'queued' | 'running' | 'done' | 'failed';

export type AuditModel = {
  id: string;
  publicUuid: string;
  pageId: string | null;
  url: string;
  status: AuditStatus;
  score: number | null;
  countsByImpact: CountsByImpact;
  axeVersion: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
  scheduledFor: Date | null;
  settled: boolean;
};
