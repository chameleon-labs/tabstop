import type {PageModel} from '../../../domain/models/page.js';
import type {UpdatePage, UpdatePageParams} from '../../../domain/usecases/update-page.js';
import type {DeleteScheduledAuditsForPageRepository} from '../../protocols/db/audit/delete-scheduled-audits-for-page-repository.js';
import type {SetPageMonitoringRepository} from '../../protocols/db/page/set-page-monitoring-repository.js';

export class DbUpdatePage implements UpdatePage {
  constructor(
    private readonly setPageMonitoringRepository: SetPageMonitoringRepository,
    private readonly deleteScheduledAuditsForPageRepository: DeleteScheduledAuditsForPageRepository,
  ) {}

  async update({pageId, userId, monitoringEnabled}: UpdatePageParams): Promise<PageModel | null> {
    // No load-then-write. Resolving the page first and updating it second is
    // where an ownership check gets skipped; the repository takes both ids, so
    // there is no statement here that could name a row this account does not
    // own.
    const page = await this.setPageMonitoringRepository.setMonitoringForUser(pageId, userId, monitoringEnabled);

    // Only once the update has matched a row, which is also the ownership
    // check: a page this account does not own updates nothing, and deleting
    // its audits on the strength of an unverified id would be a way to
    // interfere with somebody else's monitoring.
    if (page !== null && !monitoringEnabled) {
      await this.deleteScheduledAuditsForPageRepository.deleteScheduledForPage(pageId);
    }

    return page;
  }
}
