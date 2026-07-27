import type { Kysely } from 'kysely'
import type { AuditModel } from '../../../../domain/models/audit.js'
import type {
  AddAuditParams,
  AddAuditRepository
} from '../../../../data/protocols/db/audit/add-audit-repository.js'
import type {
  LoadAuditByPublicUuidRepository
} from '../../../../data/protocols/db/audit/load-audit-by-public-uuid-repository.js'
import type {
  LoadAuditByIdRepository
} from '../../../../data/protocols/db/audit/load-audit-by-id-repository.js'
import type {
  MarkRunningRepository
} from '../../../../data/protocols/db/audit/mark-running-repository.js'
import type {
  MarkDoneParams, MarkDoneRepository
} from '../../../../data/protocols/db/audit/mark-done-repository.js'
import type {
  MarkFailedRepository
} from '../../../../data/protocols/db/audit/mark-failed-repository.js'
import type { Database } from '../database.js'
import { toAuditModel } from './audit-mapper.js'

// Postgres rejects a malformed value compared against a `uuid` column (SQLSTATE
// 22P02) instead of just returning zero rows. A value that cannot be a UUID
// cannot match a row, so it's a miss, not an error — the protocol promises
// `| null`, which the database's own type checking would otherwise break.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Headroom on top of the longest an attempt can possibly occupy, so clock skew
 * between the worker and the database cannot expire a live claim.
 */
const CLAIM_SAFETY_MARGIN_MS = 60_000

/**
 * How long a claim is honoured before another delivery may take the audit.
 *
 * Derived, not chosen: an attempt occupies its job budget and may then unwind
 * for the grace period on top, so the lease has to exceed that sum or a second
 * worker can reclaim an audit the first is still running. A fixed ten minutes
 * looked generous against the 45s default and was in fact SHORTER than the
 * 600s maximum the environment schema permits plus its 15s grace.
 */
export const claimLeaseFor = (jobTimeoutMs: number, unwindGraceMs: number): number =>
  jobTimeoutMs + unwindGraceMs + CLAIM_SAFETY_MARGIN_MS

/** Safe for the largest job budget the environment schema allows. */
const DEFAULT_STALE_CLAIM_AFTER_MS = claimLeaseFor(600_000, 15_000)

export class PostgresAuditRepository implements
  AddAuditRepository,
  LoadAuditByPublicUuidRepository,
  LoadAuditByIdRepository,
  MarkRunningRepository,
  MarkDoneRepository,
  MarkFailedRepository {
  constructor (
    private readonly db: Kysely<Database>,
    private readonly staleClaimAfterMs: number = DEFAULT_STALE_CLAIM_AFTER_MS
  ) {}

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

  async loadById (auditId: string): Promise<AuditModel | null> {
    const row = await this.db
      .selectFrom('audits')
      .selectAll()
      .where('id', '=', auditId)
      .executeTakeFirst()

    return row === undefined ? null : toAuditModel(row)
  }

  async claimForRun (auditId: string): Promise<Date | null> {
    // Status alone is not mutual exclusion. Under READ COMMITTED a second
    // delivery re-evaluates this predicate after the first commits, so
    // `status in ('queued','running')` would still match the row the first
    // one just claimed - and both would run Chromium against the same audit,
    // then overwrite each other's metadata.
    //
    // The lease is what makes it exclusive: a claim younger than
    // staleClaimAfterMs excludes everyone else, while an older one is assumed
    // to belong to a worker that died and is reclaimable.
    const staleBefore = new Date(Date.now() - this.staleClaimAfterMs)
    // Kept rather than read back, so it can serve as this attempt's fence.
    const claimedAt = new Date()

    const claimed = await this.db
      .updateTable('audits')
      .set({ status: 'running', claimed_at: claimedAt })
      .where('id', '=', auditId)
      .where((eb) => eb.or([
        eb('status', '=', 'queued'),
        eb.and([
          eb('status', '=', 'running'),
          eb.or([
            eb('claimed_at', 'is', null),
            eb('claimed_at', '<', staleBefore)
          ])
        ])
      ]))
      .returning('id')
      .executeTakeFirst()

    return claimed === undefined ? null : claimedAt
  }

  async releaseClaim (auditId: string, claimedAt: Date): Promise<void> {
    // Fenced on both the status and the exact claim: an attempt that has
    // already been superseded must not hand back a claim another attempt now
    // holds, and a finished audit must never be dragged back to `queued`.
    await this.db
      .updateTable('audits')
      .set({ status: 'queued', claimed_at: null })
      .where('id', '=', auditId)
      .where('status', '=', 'running')
      .where('claimed_at', '=', claimedAt)
      .execute()
  }

  async markDone (auditId: string, result: MarkDoneParams): Promise<void> {
    await this.db
      .updateTable('audits')
      .set({
        status: 'done',
        // Stringified because node-postgres serialises a plain object as JSON
        // but an array as a Postgres array literal. The column type requires a
        // string so the compiler enforces the rule uniformly across jsonb.
        counts_by_impact: JSON.stringify(result.countsByImpact),
        axe_version: result.axeVersion,
        duration_ms: result.durationMs,
        settled: result.settled,
        completed_at: new Date()
      })
      .where('id', '=', auditId)
      .execute()
  }

  async markFailed (auditId: string, error: string): Promise<void> {
    await this.db
      .updateTable('audits')
      .set({ status: 'failed', error, completed_at: new Date() })
      .where('id', '=', auditId)
      .execute()
  }
}
