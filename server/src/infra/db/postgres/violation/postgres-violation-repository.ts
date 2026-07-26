import type { Kysely } from 'kysely'
import type { ViolationModel } from '../../../../domain/models/violation.js'
import type {
  AddViolationParams,
  AddViolationsRepository
} from '../../../../data/protocols/db/violation/add-violations-repository.js'
import type {
  LoadViolationsByAuditIdRepository
} from '../../../../data/protocols/db/violation/load-violations-by-audit-id-repository.js'
import type { Database } from '../database.js'
import { toViolationModel } from './violation-mapper.js'

export class PostgresViolationRepository
implements AddViolationsRepository, LoadViolationsByAuditIdRepository {
  constructor (private readonly db: Kysely<Database>) {}

  async addMany (auditId: string, violations: AddViolationParams[]): Promise<void> {
    // Zero violations is what a passing page produces - the success case, and
    // the most common call. Kysely throws when handed an empty VALUES list, so
    // this guard is load-bearing rather than an optimisation.
    if (violations.length === 0) return

    await this.db
      .insertInto('violations')
      .values(violations.map((violation) => ({
        audit_id: auditId,
        rule_id: violation.ruleId,
        impact: violation.impact,
        description: violation.description,
        help_url: violation.helpUrl,
        // jsonb writes must be stringified: node-postgres would otherwise
        // serialise this array as a Postgres array literal, which jsonb rejects.
        nodes: JSON.stringify(violation.nodes)
      })))
      .execute()
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
