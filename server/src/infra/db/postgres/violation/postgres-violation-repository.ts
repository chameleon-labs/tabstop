import type {Kysely} from 'kysely';
import type {ViolationModel} from '../../../../domain/models/violation.js';
import type {AddViolationParams} from '../../../../data/protocols/db/violation/violation-params.js';
import type {LoadViolationsByAuditIdRepository} from '../../../../data/protocols/db/violation/load-violations-by-audit-id-repository.js';
import type {ReplaceViolationsRepository} from '../../../../data/protocols/db/violation/replace-violations-repository.js';
import type {Database} from '../database.js';
import {toViolationModel} from './violation-mapper.js';

export class PostgresViolationRepository implements ReplaceViolationsRepository, LoadViolationsByAuditIdRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async replaceAll(auditId: string, claimedAt: Date, violations: AddViolationParams[]): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const owned = await trx
        .selectFrom('audits')
        .select('id')
        .where('id', '=', auditId)
        .where('status', '=', 'running')
        .where('claimed_at', '=', claimedAt)
        .forUpdate()
        .executeTakeFirst();

      if (owned === undefined) {
        return;
      }

      await trx.deleteFrom('violations').where('audit_id', '=', auditId).execute();

      if (violations.length === 0) {
        return;
      }

      await trx
        .insertInto('violations')
        .values(
          violations.map((violation) => ({
            audit_id: auditId,
            rule_id: violation.ruleId,
            impact: violation.impact,
            description: violation.description,
            help_url: violation.helpUrl,
            nodes: JSON.stringify(violation.nodes),
          })),
        )
        .execute();
    });
  }

  async loadByAuditId(auditId: string): Promise<ViolationModel[]> {
    const rows = await this.db
      .selectFrom('violations')
      .selectAll()
      .where('audit_id', '=', auditId)
      .orderBy('id')
      .execute();

    return rows.map(toViolationModel);
  }
}
