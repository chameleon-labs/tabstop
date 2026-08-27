import type {AccountModel} from '../models/account.js';
import type {AuthenticatedSession} from '../models/session.js';

export interface StartSession {
  start: (account: AccountModel) => Promise<AuthenticatedSession>;
}
