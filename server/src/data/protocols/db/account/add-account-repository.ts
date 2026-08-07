import type {AccountModel} from '../../../../domain/models/account.js';

export type AddAccountRepositoryParams = {
  /** Already lowercased and trimmed by validation. */
  email: string;
  passwordDigest: string;
};

export interface AddAccountRepository {
  /** Null when the email is already registered, including when a concurrent insert won the race. */
  add: (params: AddAccountRepositoryParams) => Promise<AccountModel | null>;
}
