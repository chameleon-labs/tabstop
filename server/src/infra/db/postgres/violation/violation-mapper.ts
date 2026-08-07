import type {Selectable} from 'kysely';
import type {ViolationModel} from '../../../../domain/models/violation.js';
import type {ViolationsTable} from '../database.js';

export const toViolationModel = (row: Selectable<ViolationsTable>): ViolationModel => ({
  id: row.id,
  auditId: row.audit_id,
  ruleId: row.rule_id,
  impact: row.impact,
  description: row.description,
  helpUrl: row.help_url,
  nodes: row.nodes,
});
