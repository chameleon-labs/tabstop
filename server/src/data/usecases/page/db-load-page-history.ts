import type {
  LoadPageHistory, LoadPageHistoryParams, PageHistory
} from '../../../domain/usecases/load-page-history.js'
import type {
  LoadPageHistoryRepository
} from '../../protocols/db/page/load-page-history-repository.js'

const MS_PER_DAY = 86_400_000

export class DbLoadPageHistory implements LoadPageHistory {
  constructor (private readonly loadPageHistoryRepository: LoadPageHistoryRepository) {}

  async load ({ pageId, userId, days }: LoadPageHistoryParams): Promise<PageHistory | null> {
    // The window becomes an instant here rather than in the repository, and is
    // computed once rather than as `now() - interval` inside the query: a
    // boundary the caller can see is a boundary a spec can pin, and one the
    // database recomputes per statement is not.
    const since = new Date(Date.now() - days * MS_PER_DAY)

    return await this.loadPageHistoryRepository.loadHistoryForUser(pageId, userId, since)
  }
}
