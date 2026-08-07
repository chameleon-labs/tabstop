import type {SessionModel} from '../../../../domain/models/session.js';

export type AddSessionRepositoryParams = {
  id: string;
  userId: string;
  expiresAt: Date;
};

export interface AddSessionRepository {
  add: (params: AddSessionRepositoryParams) => Promise<SessionModel>;
}
