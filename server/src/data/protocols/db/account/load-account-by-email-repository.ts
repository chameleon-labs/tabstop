import type {AccountModel} from '../../../../domain/models/account.js';

export type AccountWithDigest = {
  account: AccountModel;
  passwordDigest: string;
};

export interface LoadAccountByEmailRepository {
  loadByEmail: (email: string) => Promise<AccountWithDigest | null>;
}
