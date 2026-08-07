import type {PageConflictCode, PageLimitReachedBody} from '@tabstop/contract';

/**
 * The discriminants and the extra data of the two 409s `POST /api/pages`
 * answers with, pinned to the published union.
 *
 * The client narrows on these codes and renders `limit` as a count, so both are
 * a contract rather than an implementation detail. `codedConflict` cannot check
 * them itself - it is generic over `details` by design, so that a new coded
 * conflict elsewhere does not have to teach it a new shape - which leaves this
 * as the place a rename gets caught. Change `page_limit_reached` in the
 * contract without changing the controller, or drop `limit` from either side,
 * and the server's typecheck fails here.
 */
export const PAGE_CONFLICT: Record<'limitReached' | 'alreadyTracked', PageConflictCode> = {
  limitReached: 'page_limit_reached',
  alreadyTracked: 'page_already_tracked',
};

/** The one variant that carries data beyond the sentence. */
export const pageLimitDetails = (limit: number): Pick<PageLimitReachedBody, 'limit'> => ({limit});
