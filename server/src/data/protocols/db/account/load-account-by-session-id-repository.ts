import type {AccountModel} from '../../../../domain/models/account.js';

export interface LoadAccountBySessionIdRepository {
  /** Null when the session is unknown or expired - expiry is enforced in SQL. */
  loadBySessionId: (sessionId: string) => Promise<AccountModel | null>;
}
