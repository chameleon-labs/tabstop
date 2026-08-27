import type {PageModel} from '../models/page.js';

export type UpdatePageParams = {
  pageId: string;
  userId: string;
  monitoringEnabled: boolean;
};

export interface UpdatePage {
  update: (params: UpdatePageParams) => Promise<PageModel | null>;
}
