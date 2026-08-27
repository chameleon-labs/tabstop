import type {PageModel} from '../models/page.js';
import type {UrlRejection} from '../services/url-safety.js';

export type AddPageParams = {
  userId: string;
  url: string;
};

export type AddPageResult =
  | {
      outcome: 'added';
      page: PageModel;
      firstAuditId: string | null;
    }
  | {outcome: 'rejected'; reason: UrlRejection}
  | {outcome: 'limit-reached'; limit: number}
  | {outcome: 'duplicate'};

export interface AddPage {
  add: (params: AddPageParams) => Promise<AddPageResult>;
}
