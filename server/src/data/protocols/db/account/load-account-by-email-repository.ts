import type { AccountModel } from '../../../../domain/models/account.js'

/**
 * The digest is deliberately NOT on AccountModel - nothing in the domain should
 * be able to leak it into a response - so it travels beside the account, only
 * as far as the usecase that compares it.
 */
export type AccountWithDigest = {
  account: AccountModel
  passwordDigest: string
}

export interface LoadAccountByEmailRepository {
  loadByEmail: (email: string) => Promise<AccountWithDigest | null>
}
