/**
 * The error envelope every endpoint shares.
 *
 * `error` is the sentence to show a person, on every status, without exception -
 * see `presentation/helpers/http/http-helper.ts`, where that is the one field
 * common to `badRequest`, `unauthorized`, `notFound`, `conflict` and
 * `serverError`. Responses that a client has to BRANCH on rather than only
 * display carry extra fields alongside it; they never overload `error` itself,
 * because that would make one endpoint's `error` a different kind of thing from
 * all the others and break any generic handler.
 */
export type ApiErrorBody = {
  error: string
}

/**
 * `429`, from the rate-limit middleware.
 *
 * `resetAt` is absolute because a countdown is what a UI can render without
 * tracking when the response arrived; `retryAfter` is whole seconds, mirroring
 * the header, and never zero.
 */
export type RateLimitedBody = ApiErrorBody & {
  retryAfter: number
  resetAt: string
}

/**
 * A `409` the client branches on - "you are at your limit" wants an upgrade
 * prompt, "you already track this" wants a link - so it carries a stable
 * machine-readable `code` plus whatever the branch needs to render.
 */
export type CodedConflictBody = ApiErrorBody & {
  code: string
}
