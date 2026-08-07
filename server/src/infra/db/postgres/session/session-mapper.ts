import type {Selectable} from 'kysely';
import type {SessionModel} from '../../../../domain/models/session.js';
import type {SessionsTable} from '../database.js';

export const toSessionModel = (row: Selectable<SessionsTable>): SessionModel => ({
  id: row.id,
  userId: row.user_id,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
});
