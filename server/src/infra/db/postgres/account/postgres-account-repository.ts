import {sql, type Kysely} from 'kysely';
import type {AccountModel} from '../../../../domain/models/account.js';
import type {
  AddAccountRepository,
  AddAccountRepositoryParams,
} from '../../../../data/protocols/db/account/add-account-repository.js';
import type {
  AccountWithDigest,
  LoadAccountByEmailRepository,
} from '../../../../data/protocols/db/account/load-account-by-email-repository.js';
import type {LoadAccountBySessionIdRepository} from '../../../../data/protocols/db/account/load-account-by-session-id-repository.js';
import type {Database} from '../database.js';
import {toAccountModel} from './account-mapper.js';

const EMAIL_UNIQUE_CONSTRAINT = 'users_email_unique';

/**
 * Two concurrent signups for the same email both pass any prior existence
 * check and one hits the unique constraint. Losing that race is a normal
 * outcome - a 409, like any other duplicate - not a 500, so it is detected
 * here rather than allowed to escape as an unhandled database error.
 *
 * The constraint is matched by name (declared explicitly in migration 002,
 * not left to Postgres's auto-generated `users_email_key`) so that a future
 * constraint on this table cannot be silently swallowed as "email taken".
 */
const isEmailAlreadyTaken = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === '23505' &&
  'constraint' in error &&
  error.constraint === EMAIL_UNIQUE_CONSTRAINT;

export class PostgresAccountRepository
  implements AddAccountRepository, LoadAccountByEmailRepository, LoadAccountBySessionIdRepository
{
  constructor(private readonly db: Kysely<Database>) {}

  async add(params: AddAccountRepositoryParams): Promise<AccountModel | null> {
    try {
      const row = await this.db
        .insertInto('users')
        .values({email: params.email, password_digest: params.passwordDigest})
        .returningAll()
        .executeTakeFirstOrThrow();

      return toAccountModel(row);
    } catch (error) {
      if (isEmailAlreadyTaken(error)) return null;
      throw error;
    }
  }

  async loadByEmail(email: string): Promise<AccountWithDigest | null> {
    const row = await this.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst();

    if (row === undefined) return null;
    return {account: toAccountModel(row), passwordDigest: row.password_digest};
  }

  async loadBySessionId(sessionId: string): Promise<AccountModel | null> {
    // Expiry is enforced in SQL rather than in application code, so no caller
    // can forget it. An expired row is simply not found.
    const row = await this.db
      .selectFrom('sessions')
      .innerJoin('users', 'users.id', 'sessions.user_id')
      .selectAll('users')
      .where('sessions.id', '=', sessionId)
      .where('sessions.expires_at', '>', sql<Date>`now()`)
      .executeTakeFirst();

    return row === undefined ? null : toAccountModel(row);
  }
}
