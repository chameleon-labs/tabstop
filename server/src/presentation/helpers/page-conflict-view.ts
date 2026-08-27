import type {PageConflictCode, PageLimitReachedBody} from '@tabstop/contract';

export const PAGE_CONFLICT: Record<'limitReached' | 'alreadyTracked', PageConflictCode> = {
  limitReached: 'page_limit_reached',
  alreadyTracked: 'page_already_tracked',
};

export const pageLimitDetails = (limit: number): Pick<PageLimitReachedBody, 'limit'> => ({limit});
