import type {AuditModel} from '../models/audit.js';

export type RequestPageAuditParams = {
  userId: string;
  pageId: string;
};

/**
 * Five expected outcomes rather than exceptions, the shape `RequestAudit` and
 * `AddPage` already use. Every one of them is something a reader will meet
 * routinely; only a database that will not answer is exceptional.
 *
 * `not-found` covers a page belonging to somebody else as well as one that
 * does not exist, deliberately - telling them apart would confirm that a row
 * is real to whoever guessed its id.
 */
export type RequestPageAuditResult =
  | {outcome: 'queued'; audit: AuditModel}
  | {outcome: 'not-found'}
  | {outcome: 'in-flight'}
  | {outcome: 'allowance-spent'; resetAt: Date}
  | {outcome: 'unavailable'};

export interface RequestPageAudit {
  request: (params: RequestPageAuditParams) => Promise<RequestPageAuditResult>;
}
