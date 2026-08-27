export type ReauditRunSummary = {
  scheduledFor: string;
  pagesConsidered: number;
  auditsEnqueued: number;
  skippedDuplicate: number;
  failed: number;
  abandonedReclaimed: number;
  reclaimFailures: number;
  truncated: boolean;
};

export type RunScheduledReauditsOptions = {
  signal?: AbortSignal;
  report?: (summary: ReauditRunSummary) => void;
};

export interface RunScheduledReaudits {
  run: (now: Date, options?: RunScheduledReauditsOptions) => Promise<ReauditRunSummary>;
}
