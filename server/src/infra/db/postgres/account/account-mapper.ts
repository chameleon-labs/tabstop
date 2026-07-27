import type { Selectable } from 'kysely'
import type { AccountModel } from '../../../../domain/models/account.js'
import type { UsersTable } from '../database.js'

/** password_digest is dropped here on purpose: it must never reach the domain. */
export const toAccountModel = (row: Selectable<UsersTable>): AccountModel => ({
  id: row.id,
  email: row.email,
  alertThreshold: row.alert_threshold,
  createdAt: row.created_at
})
