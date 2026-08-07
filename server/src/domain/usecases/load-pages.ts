import type {PageSummary} from '../models/page.js';

export type LoadPagesResult = {
  pages: PageSummary[];
  /** How many pages this account may track. The dashboard renders the cap. */
  limit: number;
};

export interface LoadPages {
  /** Everything the dashboard (#20) needs, for one account, in one call. */
  load: (userId: string) => Promise<LoadPagesResult>;
}
