import type {PageSummary} from '../../../../domain/models/page.js';

export interface LoadPageSummariesRepository {
  /**
   * Every page this account owns, ordered oldest first, each with its latest
   * audit and its recent scores.
   *
   * Scoped by user rather than by site or page id, so there is no argument
   * shape here that could return somebody else's row.
   */
  loadSummariesForUser: (userId: string) => Promise<PageSummary[]>;
}
