import type { AccountModel } from './account.js'

export type SessionModel = {
  id: string
  userId: string
  createdAt: Date
  expiresAt: Date
}

/**
 * What signup and login both produce. They differ in how they establish trust,
 * not in what they hand back, so the controllers stay near-identical and the
 * cookie's expiry comes from the session row rather than being recomputed.
 */
export type AuthenticatedSession = {
  account: AccountModel
  sessionId: string
  expiresAt: Date
}
