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
   * `null` for two reasons, neither an error and neither worth retrying. The
   * page already has an audit scheduled for that day: two runs overlapped, the
   * unique index refused the second, and the audit the first one created is the
   * one that should exist. Or the page is no longer monitored: the worklist is
   * read once at the top of a run that may take half an hour, and a pause
   * arriving in between must not be overtaken by a schedule it already looked
   * for. Separate from `add` because both cases are meaningful here and
   * impossible there.
   */
  addScheduled: (params: AddScheduledAuditParams) => Promise<AuditModel | null>;
}
