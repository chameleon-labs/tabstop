import type { AuthenticatedSession } from '../models/session.js'

export type AddAccountParams = {
  email: string
  password: string
}

export interface AddAccount {
  /** Null when the email is already registered. */
  add: (params: AddAccountParams) => Promise<AuthenticatedSession | null>
}
