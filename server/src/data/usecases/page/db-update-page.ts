import type {PageModel} from '../../../domain/models/page.js';
import type {UpdatePage, UpdatePageParams} from '../../../domain/usecases/update-page.js';
import type {SetPageMonitoringRepository} from '../../protocols/db/page/set-page-monitoring-repository.js';

export class DbUpdatePage implements UpdatePage {
  constructor(private readonly setPageMonitoringRepository: SetPageMonitoringRepository) {}

  async update({pageId, userId, monitoringEnabled}: UpdatePageParams): Promise<PageModel | null> {
    return await this.setPageMonitoringRepository.setMonitoringForUser(pageId, userId, monitoringEnabled);
  }
}
