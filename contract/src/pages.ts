/**
 * The two 409s `POST /api/pages` answers with, as separate variants.
 *
 * Both are conflicts a client has to TELL APART rather than only display - "you
 * are at your limit" wants an upgrade prompt, "you already track this" wants a
 * link to the page - which is why the server sends a machine-readable `code`
 * alongside the sentence.
 *
 * Declared as a discriminated union rather than as `code: string` because the
 * variants do not carry the same data: the limit case sends the limit, and a
 * screen that says "you are tracking 10 of 10 pages" cannot get that number
 * from anywhere else. A single loose shape drops it on the floor.
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
