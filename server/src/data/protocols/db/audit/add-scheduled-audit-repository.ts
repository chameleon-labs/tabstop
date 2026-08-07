import type {AuditModel} from '../../../../domain/models/audit.js';

export type AddScheduledAuditParams = {
  pageId: string;
  url: string;
  /** The run's UTC day as `YYYY-MM-DD`. Stamped on the row, not derived from it. */
  scheduledFor: string;
};

export interface AddScheduledAuditRepository {
  /**
   * Inserts the queued audit for one page's nightly run.
   *
   * `null` when this page already has an audit scheduled for that day. That is
   * not an error and it is not a race the caller should retry: two runs
   * overlapped, the unique index refused the second, and the audit the first
   * one created is the one that should exist. Separate from `add` because the
   * conflict is meaningful here and impossible there.
   */
  addScheduled: (params: AddScheduledAuditParams) => Promise<AuditModel | null>;
}
