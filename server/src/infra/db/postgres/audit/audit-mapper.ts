import type {Selectable} from 'kysely';
import type {AuditModel} from '../../../../domain/models/audit.js';
import {IMPACTS, type CountsByImpact, type Impact} from '../../../../domain/models/impact.js';
import type {AuditsTable} from '../database.js';

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
  scheduledFor: row.scheduled_for,
  settled: row.settled,
});
