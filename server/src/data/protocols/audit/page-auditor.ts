import type {AddViolationParams} from '../db/violation/violation-params.js';

export type AuditPageResult = {
  violations: AddViolationParams[];
  axeVersion: string;
  durationMs: number;
  settled: boolean;
};

export interface PageAuditor {
  audit: (url: string, signal: AbortSignal) => Promise<AuditPageResult>;
}
