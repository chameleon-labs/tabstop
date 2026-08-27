import type {PageHistory} from '../../../../domain/usecases/load-page-history.js';

export interface LoadPageHistoryRepository {
  loadHistoryForUser: (pageId: string, userId: string, since: Date) => Promise<PageHistory | null>;
}
