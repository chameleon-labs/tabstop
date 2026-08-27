import type {AccountModel} from '../models/account.js';

export interface LoadAccountBySession {
  load: (sessionId: string) => Promise<AccountModel | null>;
}
