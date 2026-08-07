/**
 * The two 409s `POST /api/pages` answers with, as separate variants.
 *
 * A discriminated union rather than `code: string` because the variants carry
 * different data: only the limit case sends the limit, and a screen saying
 * "tracking 10 of 10 pages" can get that number from nowhere else.
 */
export type PageLimitReachedBody = {
  code: 'page_limit_reached'
  error: string
  /** The cap that was hit, so the message can name it rather than hardcode it. */
  limit: number
}

export type PageAlreadyTrackedBody = {
  code: 'page_already_tracked'
  error: string
}

export type PageConflictBody = PageLimitReachedBody | PageAlreadyTrackedBody

/** Every code this endpoint may send, for a client that wants to be exhaustive. */
export type PageConflictCode = PageConflictBody['code']
