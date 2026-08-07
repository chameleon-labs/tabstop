import type {AuditModel} from './audit.js';

export type PageModel = {
  id: string;
  siteId: string;
  url: string;
  monitoringEnabled: boolean;
  createdAt: Date;
};

/** One point on the dashboard sparkline (#20). Only a finished audit has one. */
export type PageScorePoint = {
  score: number;
  at: Date;
};

/**
 * A page as the dashboard reads it: the row, the site it belongs to, the last
 * audit whatever became of it, and the recent scores.
 *
 * `latestAudit` is deliberately the latest audit of ANY status, not the latest
 * scored one. The dashboard has to make "this page is broken" look different
 * from "this page scores badly", and that distinction lives in the status of
 * the most recent run - which `history`, holding only finished audits, cannot
 * express.
 */
export type PageSummary = {
  page: PageModel;
  /** The host the page's site is grouped under. */
  domain: string;
  latestAudit: AuditModel | null;
  /** Oldest first, so a sparkline renders in array order. Bounded. */
  history: PageScorePoint[];
};
