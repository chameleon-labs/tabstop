import type { Kysely } from 'kysely'
import type { AuditModel } from '../../../../domain/models/audit.js'
import type {
  AddAuditParams,
  AddAuditRepository
} from '../../../../data/protocols/db/audit/add-audit-repository.js'
import type {
  LoadAuditByPublicUuidRepository
} from '../../../../data/protocols/db/audit/load-audit-by-public-uuid-repository.js'
import type { Database } from '../database.js'
import { toAuditModel } from './audit-mapper.js'

// Postgres rejects a malformed value compared against a `uuid` column (SQLSTATE
// 22P02) instead of just returning zero rows. A value that cannot be a UUID
// cannot match a row, so it's a miss, not an error — the protocol promises
// `| null`, which the database's own type checking would otherwise break.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class PostgresAuditRepository implements AddAuditRepository, LoadAuditByPublicUuidRepository {
  constructor (private readonly db: Kysely<Database>) {}

  async add (params: AddAuditParams): Promise<AuditModel> {
    // score, axe_version, duration_ms, error and completed_at are omitted
    // deliberately: the database supplies null, and the worker (#5) fills them.
    const row = await this.db
      .insertInto('audits')
      .values({ url: params.url, page_id: params.pageId, status: 'queued' })
      .returningAll()
      .executeTakeFirstOrThrow()

    return toAuditModel(row)
  }

  async loadByPublicUuid (publicUuid: string): Promise<AuditModel | null> {
    if (!UUID_PATTERN.test(publicUuid)) return null

    const row = await this.db
      .selectFrom('audits')
      .selectAll()
      .where('public_uuid', '=', publicUuid)
      .executeTakeFirst()

    return row === undefined ? null : toAuditModel(row)
  }
}
