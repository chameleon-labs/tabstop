import type { AccountResponse } from '@tabstop/contract'
import type { AccountModel } from '../../domain/models/account.js'
import type { Exact, MustHold } from './contract-proof.js'

/**
 * What an account looks like over the wire. Explicit rather than returning the
 * model, so a field added to AccountModel is never exposed by accident -
 * `AccountModel` carries the password hash, which is what makes "by accident"
 * the thing to design against.
 */
export type AccountView = {
  id: string
  email: string
  alertThreshold: number
}

/**
 * Kept as its own declaration rather than aliased to `AccountResponse`, because
 * an alias would make the assertion below say nothing. Declared twice and
 * checked is a boundary; declared once and re-exported is a rename.
 */
type ViewMatchesContract = MustHold<Exact<AccountView, AccountResponse>>
export type ContractProof = [ViewMatchesContract]

export const toAccountView = (account: AccountModel): AccountView => ({
  id: account.id,
  email: account.email,
  alertThreshold: account.alertThreshold
})
