import type {AccountModel} from './account.js';

export type SessionModel = {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
};

export type AuthenticatedSession = {
  account: AccountModel;
  sessionId: string;
  expiresAt: Date;
};
