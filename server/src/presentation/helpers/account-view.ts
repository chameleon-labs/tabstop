import type {AccountResponse} from '@tabstop/contract';
import type {AccountModel} from '../../domain/models/account.js';
import type {Exact, MustHold} from './contract-proof.js';

export type AccountView = {
  id: string;
  email: string;
  alertThreshold: number;
};

type ViewMatchesContract = MustHold<Exact<AccountView, AccountResponse>>;
export type ContractProof = [ViewMatchesContract];

export const toAccountView = (account: AccountModel): AccountView => ({
  id: account.id,
  email: account.email,
  alertThreshold: account.alertThreshold,
});
