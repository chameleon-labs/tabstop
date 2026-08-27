import type {AccountModel} from '../../../../domain/models/account.js';

export type AddAccountRepositoryParams = {
  email: string;
  passwordDigest: string;
};

export interface AddAccountRepository {
  add: (params: AddAccountRepositoryParams) => Promise<AccountModel | null>;
}
