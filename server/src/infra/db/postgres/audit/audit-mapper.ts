import type {Selectable} from 'kysely';
import type {AuditModel} from '../../../../domain/models/audit.js';
import {IMPACTS, type CountsByImpact, type Impact} from '../../../../domain/models/impact.js';
import type {AuditsTable} from '../database.js';

/**
 * jsonb carries no schema, so a row written by anything other than this
 * repository can be missing keys the domain type promises are present. The
 * check constraint makes that unreachable through our own writes; this keeps
 * the domain type honest against every other writer.
 */
const toCountsByImpact = (raw: Partial<Record<Impact, number>>): CountsByImpact => {
  const counts: CountsByImpact = {minor: 0, moderate: 0, serious: 0, critical: 0};
  for (const impact of IMPACTS) {
    const value = raw[impact];
    if (value !== undefined) {
      counts[impact] = value;
    }
  }
  return counts;
};

export const toAuditModel = (row: Selectable<AuditsTable>): AuditModel => ({
  id: row.id,
  publicUuid: row.public_uuid,
  pageId: row.page_id,
  url: row.url,
  status: row.status,
  score: row.score,
  countsByImpact: toCountsByImpact(row.counts_by_impact),
  axeVersion: row.axe_version,
  durationMs: row.duration_ms,
  error: row.error,
  createdAt: row.created_at,
  completedAt: row.completed_at,
  settled: row.settled,
});
