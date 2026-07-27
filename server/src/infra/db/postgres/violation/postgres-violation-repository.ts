import type { Kysely } from 'kysely'
import type { ViolationModel } from '../../../../domain/models/violation.js'
import type { AddViolationParams } from '../../../../data/protocols/db/violation/violation-params.js'
import type {
  LoadViolationsByAuditIdRepository
} from '../../../../data/protocols/db/violation/load-violations-by-audit-id-repository.js'
import type {
  ReplaceViolationsRepository
} from '../../../../data/protocols/db/violation/replace-violations-repository.js'
import type { Database } from '../database.js'
import { toViolationModel } from './violation-mapper.js'

export class PostgresViolationRepository
implements ReplaceViolationsRepository, LoadViolationsByAuditIdRepository {
  constructor (private readonly db: Kysely<Database>) {}

  async replaceAll (
    auditId: string, claimedAt: Date, violations: AddViolationParams[]
  ): Promise<void> {
    // Delete and insert in one transaction, so a retry can never see a
    // half-replaced set and can never double-insert. Both statements are on
    // this table, so the transaction is local to this repository - no
    // cross-repository unit of work is needed.
    await this.db.transaction().execute(async (trx) => {
      // Lock the parent audit first. The transaction alone makes ONE
      // replacement atomic but does not serialise two: under READ COMMITTED,
      // concurrent attempts both delete zero rows and both insert, duplicating
      // everything. Taking the audit row makes replacements for the same audit
      // queue behind each other.
      const owned = await trx.selectFrom('audits').select('id')
        .where('id', '=', auditId)
        // Ownership is checked WHILE holding the lock, not before taking it:
        // an attempt that paused past its lease can resume here after another
        // worker claimed and finished the audit, and would otherwise replace
        // the new owner's violations with its own stale set.
        .where('status', '=', 'running')
        .where('claimed_at', '=', claimedAt)
        .forUpdate().executeTakeFirst()

      if (owned === undefined) return

      await trx.deleteFrom('violations').where('audit_id', '=', auditId).execute()

      // Kysely throws on an empty VALUES list, and a clean page is the most
      // common case, so this guard is load-bearing rather than an optimisation.
      if (violations.length === 0) return

      await trx
        .insertInto('violations')
        .values(violations.map((violation) => ({
          audit_id: auditId,
          rule_id: violation.ruleId,
          impact: violation.impact,
          description: violation.description,
          help_url: violation.helpUrl,
          // jsonb writes must be stringified: node-postgres would otherwise
          // serialise this array as a Postgres array literal, which jsonb
          // rejects.
          nodes: JSON.stringify(violation.nodes)
        })))
        .execute()
    })
  }

  async loadByAuditId (auditId: string): Promise<ViolationModel[]> {
    const rows = await this.db
      .selectFrom('violations')
      .selectAll()
      .where('audit_id', '=', auditId)
      .orderBy('id')
      .execute()

    return rows.map(toViolationModel)
  }
}
