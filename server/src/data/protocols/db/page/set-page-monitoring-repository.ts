import type {PageModel} from '../../../../domain/models/page.js';

export interface SetPageMonitoringRepository {
  setMonitoringForUser: (pageId: string, userId: string, monitoringEnabled: boolean) => Promise<PageModel | null>;
}
