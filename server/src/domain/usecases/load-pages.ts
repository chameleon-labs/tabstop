import type {ScheduledPageSummary} from '../models/page.js';

export type LoadPagesResult = {
  pages: ScheduledPageSummary[];
  limit: number;
};

export interface LoadPages {
  load: (userId: string) => Promise<LoadPagesResult>;
}
