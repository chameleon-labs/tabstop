import type {AuditModel} from '../models/audit.js';
import type {PageModel} from '../models/page.js';

export type LoadPageHistoryParams = {
  pageId: string;
  userId: string;
  days: number;
};

export type PageHistory = {
  page: PageModel;
  audits: AuditModel[];
};

export interface LoadPageHistory {
  load: (params: LoadPageHistoryParams) => Promise<PageHistory | null>;
}
