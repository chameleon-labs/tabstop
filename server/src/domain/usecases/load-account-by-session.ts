import type { AccountModel } from '../models/account.js'

export interface LoadAccountBySession {
  /** Null when the session is unknown or expired. */
  load: (sessionId: string) => Promise<AccountModel | null>
}
