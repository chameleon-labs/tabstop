import type { AccountModel } from '../../domain/models/account.js'

/**
 * What an account looks like over the wire. Explicit rather than returning the
 * model, so a field added to AccountModel is never exposed by accident.
 */
export type AccountView = {
  id: string
  email: string
  alertThreshold: number
}

export const toAccountView = (account: AccountModel): AccountView => ({
  id: account.id,
  email: account.email,
  alertThreshold: account.alertThreshold
})
