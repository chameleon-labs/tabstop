import { vi } from 'vitest'
import type { AccountModel } from '../../domain/models/account.js'
import type { AuthenticatedSession } from '../../domain/models/session.js'
import type { AddAccount } from '../../domain/usecases/add-account.js'
import type { Authenticate } from '../../domain/usecases/authenticate.js'
import type { LoadAccountBySession } from '../../domain/usecases/load-account-by-session.js'
import type { RevokeSession } from '../../domain/usecases/revoke-session.js'
import type { Validation } from '../protocols/validation.js'

export const mockAccountModel = (): AccountModel => ({
  id: 'any-user-id',
  email: 'any@example.test',
  alertThreshold: 5,
  createdAt: new Date('2026-07-26T00:00:00Z')
})

export const mockAuthenticatedSession = (): AuthenticatedSession => ({
  account: mockAccountModel(),
  sessionId: 'any-session-id',
  expiresAt: new Date('2026-08-25T00:00:00Z')
})

export const mockAddAccount = () => ({
  add: vi.fn<AddAccount['add']>(async () => mockAuthenticatedSession())
})

export const mockAuthenticate = () => ({
  auth: vi.fn<Authenticate['auth']>(async () => mockAuthenticatedSession())
})

export const mockLoadAccountBySession = () => ({
  load: vi.fn<LoadAccountBySession['load']>(async () => mockAccountModel())
})

export const mockRevokeSession = () => ({
  revoke: vi.fn<RevokeSession['revoke']>(async () => { /* no-op */ })
})

/** Passes input straight through, so a controller spec exercises the happy path. */
export const mockValidation = <T>(data: T) => ({
  validate: vi.fn<Validation<T>['validate']>(() => ({ data }))
})
