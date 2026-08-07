import {vi} from 'vitest';
import type {AccountModel} from '../../domain/models/account.js';
import type {AuthenticatedSession, SessionModel} from '../../domain/models/session.js';
import type {StartSession} from '../../domain/usecases/start-session.js';
import type {Hasher} from '../protocols/cryptography/hasher.js';
import type {HashComparer} from '../protocols/cryptography/hash-comparer.js';
import type {SessionIdGenerator} from '../protocols/cryptography/session-id-generator.js';
import type {AddAccountRepository} from '../protocols/db/account/add-account-repository.js';
import type {LoadAccountByEmailRepository} from '../protocols/db/account/load-account-by-email-repository.js';
import type {LoadAccountBySessionIdRepository} from '../protocols/db/account/load-account-by-session-id-repository.js';
import type {AddSessionRepository} from '../protocols/db/session/add-session-repository.js';
import type {DeleteSessionRepository} from '../protocols/db/session/delete-session-repository.js';

export const mockAccountModel = (): AccountModel => ({
  id: 'any-user-id',
  email: 'any@example.test',
  alertThreshold: 5,
  createdAt: new Date('2026-07-26T00:00:00Z'),
});

export const mockSessionModel = (): SessionModel => ({
  id: 'any-session-id',
  userId: 'any-user-id',
  createdAt: new Date('2026-07-26T00:00:00Z'),
  expiresAt: new Date('2026-08-25T00:00:00Z'),
});

export const mockAuthenticatedSession = (): AuthenticatedSession => ({
  account: mockAccountModel(),
  sessionId: 'any-session-id',
  expiresAt: new Date('2026-08-25T00:00:00Z'),
});

/**
 * Each mock is typed against its protocol rather than inferred from the stub
 * body. An inferred type excludes the null branch these protocols declare,
 * which would make every failure case unmockable.
 */
export const mockHasher = () => ({
  hash: vi.fn<Hasher['hash']>(() => Promise.resolve('hashed')),
});

export const mockHashComparer = () => ({
  compare: vi.fn<HashComparer['compare']>(() => Promise.resolve(true)),
});

export const mockSessionIdGenerator = () => ({
  generate: vi.fn<SessionIdGenerator['generate']>(() => 'generated-session-id'),
});

export const mockAddAccountRepository = () => ({
  add: vi.fn<AddAccountRepository['add']>(() => Promise.resolve(mockAccountModel())),
});

export const mockLoadAccountByEmailRepository = () => ({
  loadByEmail: vi.fn<LoadAccountByEmailRepository['loadByEmail']>(() =>
    Promise.resolve({
      account: mockAccountModel(),
      passwordDigest: 'stored-digest',
    }),
  ),
});

export const mockLoadAccountBySessionIdRepository = () => ({
  loadBySessionId: vi.fn<LoadAccountBySessionIdRepository['loadBySessionId']>(() =>
    Promise.resolve(mockAccountModel()),
  ),
});

export const mockAddSessionRepository = () => ({
  add: vi.fn<AddSessionRepository['add']>((params) =>
    Promise.resolve({
      id: params.id,
      userId: params.userId,
      createdAt: new Date('2026-07-26T00:00:00Z'),
      expiresAt: params.expiresAt,
    }),
  ),
});

export const mockDeleteSessionRepository = () => ({
  deleteById: vi.fn<DeleteSessionRepository['deleteById']>(async () => {
    /* no-op */
  }),
});

export const mockStartSession = () => ({
  start: vi.fn<StartSession['start']>((account) =>
    Promise.resolve({
      account,
      sessionId: 'any-session-id',
      expiresAt: new Date('2026-08-25T00:00:00Z'),
    }),
  ),
});
