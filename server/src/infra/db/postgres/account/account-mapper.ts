import type {Selectable} from 'kysely';
import type {AccountModel} from '../../../../domain/models/account.js';
import type {UsersTable} from '../database.js';

export const toAccountModel = (row: Selectable<UsersTable>): AccountModel => ({
  id: row.id,
  email: row.email,
  alertThreshold: row.alert_threshold,
  createdAt: row.created_at,
});
