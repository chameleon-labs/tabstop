import {sql, type Kysely} from 'kysely';
import type {DatabaseHealthProvider} from '../../../../data/protocols/db/database-health-provider.js';
import type {Database} from '../database.js';

export class PostgresHealthAdapter implements DatabaseHealthProvider {
  constructor(private readonly db: Kysely<Database>) {}

  async isReachable(): Promise<boolean> {
    try {
      await sql`select 1`.execute(this.db);
      return true;
    } catch (error) {
      console.error('Postgres health check failed:', error);
      return false;
    }
  }
}
