import type {PageSummary} from '../../../../domain/models/page.js';

export interface LoadPageSummariesRepository {
  loadSummariesForUser: (userId: string) => Promise<PageSummary[]>;
}
