import type {PageModel} from '../../../domain/models/page.js';
import type {UpdatePage, UpdatePageParams} from '../../../domain/usecases/update-page.js';
import type {SetPageMonitoringRepository} from '../../protocols/db/page/set-page-monitoring-repository.js';

export class DbUpdatePage implements UpdatePage {
  constructor(private readonly setPageMonitoringRepository: SetPageMonitoringRepository) {}

  async update({pageId, userId, monitoringEnabled}: UpdatePageParams): Promise<PageModel | null> {
    // No load-then-write. Resolving the page first and updating it second is
    // where an ownership check gets skipped; the repository takes both ids, so
    // there is no statement here that could name a row this account does not
    // own.
    return await this.setPageMonitoringRepository.setMonitoringForUser(pageId, userId, monitoringEnabled);
  }
}
