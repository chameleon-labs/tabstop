import {DbAddAccount} from '../../../../data/usecases/account/db-add-account.js';
import {DbAuthenticate} from '../../../../data/usecases/account/db-authenticate.js';
import {DbLoadAccountBySession} from '../../../../data/usecases/account/db-load-account-by-session.js';
import {DbRevokeSession} from '../../../../data/usecases/account/db-revoke-session.js';
import {DbStartSession} from '../../../../data/usecases/account/db-start-session.js';
import type {AddAccount} from '../../../../domain/usecases/add-account.js';
import type {Authenticate} from '../../../../domain/usecases/authenticate.js';
import type {LoadAccountBySession} from '../../../../domain/usecases/load-account-by-session.js';
import type {RevokeSession} from '../../../../domain/usecases/revoke-session.js';
import type {StartSession} from '../../../../domain/usecases/start-session.js';
import {ScryptAdapter} from '../../../../infra/cryptography/scrypt-adapter.js';
import {SessionIdAdapter} from '../../../../infra/cryptography/session-id-adapter.js';
import {PostgresAccountRepository} from '../../../../infra/db/postgres/account/postgres-account-repository.js';
import {PostgresSessionRepository} from '../../../../infra/db/postgres/session/postgres-session-repository.js';
import {getDatabase} from '../../../config/database.js';
import {env} from '../../../config/env.js';

const makeScryptAdapter = (): ScryptAdapter => new ScryptAdapter(env.scryptCost);

const makeStartSession = (): StartSession =>
  new DbStartSession(new SessionIdAdapter(), new PostgresSessionRepository(getDatabase()), env.sessionTtlDays);

export const makeAddAccount = (): AddAccount =>
  new DbAddAccount(makeScryptAdapter(), new PostgresAccountRepository(getDatabase()), makeStartSession());

export const makeAuthenticate = (): Authenticate => {
  const scrypt = makeScryptAdapter();
  return new DbAuthenticate(new PostgresAccountRepository(getDatabase()), scrypt, scrypt, makeStartSession());
};

export const makeLoadAccountBySession = (): LoadAccountBySession =>
  new DbLoadAccountBySession(new PostgresAccountRepository(getDatabase()));

export const makeRevokeSession = (): RevokeSession => new DbRevokeSession(new PostgresSessionRepository(getDatabase()));
