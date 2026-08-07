/**
 * The error envelope every endpoint shares.
 *
 * `error` is the sentence to show a person, on every status without exception.
 * Responses a client must BRANCH on carry extra fields alongside it and never
 * overload `error` itself, which would make one endpoint's `error` a different
 * kind of thing from the rest and break any generic handler.
 */
export type ApiErrorBody = {
  error: string;
};

/**
 * `429`, from the rate-limit middleware.
 *
 * `resetAt` is absolute so a UI can render a countdown without tracking when
 * the response arrived; `retryAfter` is whole seconds, mirroring the header,
 * and never zero.
 */
export type RateLimitedBody = ApiErrorBody & {
  retryAfter: number;
  resetAt: string;
};

/**
 * A `409` the client branches on - "you are at your limit" wants an upgrade
 * prompt, "you already track this" wants a link - so it carries a stable
 * machine-readable `code` plus whatever the branch needs to render.
 */
export type CodedConflictBody = ApiErrorBody & {
  code: string;
};
