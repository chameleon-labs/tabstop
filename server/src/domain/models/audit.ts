import type {CountsByImpact} from './impact.js';

export type AuditStatus = 'queued' | 'running' | 'done' | 'failed';

export type AuditModel = {
  id: string;
  /** The only id ever exposed publicly; the share page (#23) is addressed by it. */
  publicUuid: string;
  /** Null for a one-off anonymous audit. */
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
  /** False when the page never finished loading and was audited anyway. */
  settled: boolean;
};
