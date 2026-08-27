import type {AuditModel} from '../../../../domain/models/audit.js';
import type {PageModel} from '../../../../domain/models/page.js';

export type AddPageRepositoryParams = {
  userId: string;
  domain: string;
  url: string;
  limit: number;
};

export type AddPageRepositoryResult =
  | {outcome: 'added'; page: PageModel; firstAudit: AuditModel}
  | {outcome: 'limit-reached'}
  | {outcome: 'duplicate'};

export interface AddPageRepository {
  add: (params: AddPageRepositoryParams) => Promise<AddPageRepositoryResult>;
}
