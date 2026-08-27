import type {LoadPageHistory, LoadPageHistoryParams, PageHistory} from '../../../domain/usecases/load-page-history.js';
import type {LoadPageHistoryRepository} from '../../protocols/db/page/load-page-history-repository.js';

const MS_PER_DAY = 86_400_000;

export class DbLoadPageHistory implements LoadPageHistory {
  constructor(private readonly loadPageHistoryRepository: LoadPageHistoryRepository) {}

  async load({pageId, userId, days}: LoadPageHistoryParams): Promise<PageHistory | null> {
    const since = new Date(Date.now() - days * MS_PER_DAY);

    return await this.loadPageHistoryRepository.loadHistoryForUser(pageId, userId, since);
  }
}
