/**
 * The HTTP contract between `server/` and `web/`, and the only thing they share.
 *
 * TYPES ONLY, and enforced rather than asked for. The package exposes a `types`
 * condition and no runtime entry at all, so adding a value export here and
 * importing it fails at the point of use - `vite build` cannot resolve the
 * specifier, and Node refuses it with ERR_PACKAGE_PATH_NOT_EXPORTED. Both were
 * checked by doing it. The failure is loud and immediate rather than a quiet
 * extra kilobyte of server code in a browser bundle.
 *
 * Importing one of the types below as a VALUE is a separate mistake, caught
 * separately: `verbatimModuleSyntax` is on in both packages, so it is a
 * typecheck error (TS1484) before it is anything else.
 *
 * What must stay on the server: `toAuditResultResponse`. That mapper is a
 * security boundary - `AuditModel` carries `pageId`, which links to a site and
 * therefore to an account - and it has a spec asserting the forbidden keys are
 * absent. Moving transport types out must never let the mapper follow.
 */
export type {
  AuditResultResponse,
  AuditStatus,
  CountsByImpact,
  Impact,
  RequestAuditResponse,
  Violation,
  ViolationNode
} from './audit.js'

export type { AccountResponse } from './account.js'

export type {
  ApiErrorBody,
  CodedConflictBody,
  RateLimitedBody
} from './http.js'
