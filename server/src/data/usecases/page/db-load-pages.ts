import type { LoadPages, LoadPagesResult } from '../../../domain/usecases/load-pages.js'
import type {
  LoadPageSummariesRepository
} from '../../protocols/db/page/load-page-summaries-repository.js'

export class DbLoadPages implements LoadPages {
  constructor (
    private readonly loadPageSummariesRepository: LoadPageSummariesRepository,
    private readonly limit: number
  ) {}

  async load (userId: string): Promise<LoadPagesResult> {
    // The limit rides along with the list so the dashboard can show "7 of 10"
    // before anyone hits the cap, rather than discovering it as a rejection.
    return {
      pages: await this.loadPageSummariesRepository.loadSummariesForUser(userId),
      limit: this.limit
    }
  }
}
