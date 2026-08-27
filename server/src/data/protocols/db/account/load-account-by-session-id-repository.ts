import type {AccountModel} from '../../../../domain/models/account.js';

export interface LoadAccountBySessionIdRepository {
  loadBySessionId: (sessionId: string) => Promise<AccountModel | null>;
}
