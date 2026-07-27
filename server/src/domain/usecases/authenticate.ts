import type { AuthenticatedSession } from '../models/session.js'

export type AuthenticateParams = {
  email: string
  password: string
}

export interface Authenticate {
  /** Null for both an unknown email and a wrong password - the caller cannot tell them apart. */
  auth: (params: AuthenticateParams) => Promise<AuthenticatedSession | null>
}
