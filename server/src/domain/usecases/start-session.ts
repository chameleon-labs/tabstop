import type {AccountModel} from '../models/account.js';
import type {AuthenticatedSession} from '../models/session.js';

/**
 * Shared by signup and login so the session's lifetime, id generation and
 * persistence are defined once.
 */
export interface StartSession {
  start: (account: AccountModel) => Promise<AuthenticatedSession>;
}
