/**
 * The HTTP contract between `server/` and `web/`, and the only thing they share.
 *
 * TYPES ONLY, and enforced: the package exposes a `types` condition and no
 * runtime entry, so a value export added here fails at the point of use rather
 * than shipping server code in a browser bundle. Importing one of these as a
 * value is caught separately by `verbatimModuleSyntax` (TS1484).
 *
 * `toAuditResultResponse` must stay on the server - it is a security boundary,
 * since `AuditModel` carries `pageId`, which links to an account.
 */
export type {
  AuditResultResponse,
  AuditStatus,
  CountsByImpact,
  Impact,
  RequestAuditResponse,
  Violation,
  ViolationNode,
} from './audit.js';

export type {AccountResponse} from './account.js';

export type {
  AddPageResponse,
  LatestPageAudit,
  LoadPagesResponse,
  PageAlreadyTrackedBody,
  PageConflictBody,
  PageConflictCode,
  PageLimitReachedBody,
  PageScorePoint,
  PageSummary,
  PageView,
  UpdatePageResponse,
} from './pages.js';

export type {ApiErrorBody, CodedConflictBody, RateLimitedBody} from './http.js';
