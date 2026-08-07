import {sql, type Kysely, type SqlBool} from 'kysely';
import type {AuditModel} from '../../../../domain/models/audit.js';
import type {AddAuditParams, AddAuditRepository} from '../../../../data/protocols/db/audit/add-audit-repository.js';
import type {
  AddScheduledAuditParams,
  AddScheduledAuditRepository,
} from '../../../../data/protocols/db/audit/add-scheduled-audit-repository.js';
import type {LoadAuditByPublicUuidRepository} from '../../../../data/protocols/db/audit/load-audit-by-public-uuid-repository.js';
import type {LoadAuditByIdRepository} from '../../../../data/protocols/db/audit/load-audit-by-id-repository.js';
import type {MarkRunningRepository} from '../../../../data/protocols/db/audit/mark-running-repository.js';
import type {
  CompleteAuditParams,
  CompleteAuditRepository,
} from '../../../../data/protocols/db/audit/complete-audit-repository.js';
import type {MarkFailedRepository} from '../../../../data/protocols/db/audit/mark-failed-repository.js';
import type {DeleteQueuedAuditRepository} from '../../../../data/protocols/db/audit/delete-queued-audit-repository.js';
import type {
  ReclaimAbandonedAuditsRepository,
  StaleAudit,
} from '../../../../data/protocols/db/audit/reclaim-abandoned-audits-repository.js';
import type {Database} from '../database.js';
import {detectRegression} from '../../../../domain/services/regression.js';
import {toAuditModel} from './audit-mapper.js';

// Postgres rejects a malformed value compared against a `uuid` column (SQLSTATE
// 22P02) instead of just returning zero rows. A value that cannot be a UUID
// cannot match a row, so it's a miss, not an error — the protocol promises
// `| null`, which the database's own type checking would otherwise break.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Headroom on top of the longest an attempt can possibly occupy, so clock skew
 * between the worker and the database cannot expire a live claim.
 */
const CLAIM_SAFETY_MARGIN_MS = 60_000;

/**
 * How long a claim is honoured before another delivery may take the audit.
 *
 * Derived, not chosen: an attempt occupies its job budget then unwinds for the
 * grace period, so the lease must exceed that sum or a second worker reclaims
 * an audit the first is still running. A fixed ten minutes looked generous
 * against the 45s default and was SHORTER than the permitted 600s plus grace.
 */
export const claimLeaseFor = (jobTimeoutMs: number, unwindGraceMs: number): number =>
  jobTimeoutMs + unwindGraceMs + CLAIM_SAFETY_MARGIN_MS;

/** Safe for the largest job budget the environment schema allows. */
const DEFAULT_STALE_CLAIM_AFTER_MS = claimLeaseFor(600_000, 15_000);

const writeDone = async (
  db: Kysely<Database>,
  auditId: string,
  claimedAt: Date,
  result: CompleteAuditParams,
): Promise<{page_id: string | null; created_at: Date} | undefined> =>
  await db
    .updateTable('audits')
    .set({
      status: 'done',
      score: result.score,
      // Stringified because node-postgres serialises a plain object as JSON
      // but an array as a Postgres array literal. The column type requires a
      // string so the compiler enforces the rule uniformly across jsonb.
      counts_by_impact: JSON.stringify(result.countsByImpact),
      axe_version: result.axeVersion,
      duration_ms: result.durationMs,
      settled: result.settled,
      completed_at: new Date(),
    })
    .where('id', '=', auditId)
    // Fenced: an attempt that lost its claim must not overwrite the result
    // of the worker that reclaimed the audit - or emit an alert for it.
    .where('status', '=', 'running')
    .where('claimed_at', '=', claimedAt)
    .returning(['page_id', 'created_at'])
    .executeTakeFirst();

export class PostgresAuditRepository
  implements
    AddAuditRepository,
    AddScheduledAuditRepository,
    LoadAuditByPublicUuidRepository,
    LoadAuditByIdRepository,
    MarkRunningRepository,
    CompleteAuditRepository,
    MarkFailedRepository,
    DeleteQueuedAuditRepository,
    ReclaimAbandonedAuditsRepository
{
  constructor(
    private readonly db: Kysely<Database>,
    private readonly staleClaimAfterMs: number = DEFAULT_STALE_CLAIM_AFTER_MS,
  ) {}

  async add(params: AddAuditParams): Promise<AuditModel> {
    // score, axe_version, duration_ms, error and completed_at are omitted
    // deliberately: the database supplies null, and the worker (#5) fills them.
    const row = await this.db
      .insertInto('audits')
      .values({url: params.url, page_id: params.pageId, status: 'queued'})
      .returningAll()
      .executeTakeFirstOrThrow();

    return toAuditModel(row);
  }

  /**
   * The nightly run's audit for one page.
   *
   * `on conflict ... do nothing` rather than catching 23505: an error inside a
   * transaction aborts it, and the caller loops over every monitored page.
   * Zero rows leaves the connection usable and IS the answer - null, meaning
   * another run already scheduled this page today.
   *
   * The target is columns plus the index predicate, not `on constraint`: a
   * partial unique index is not a constraint and cannot be inferred by name.
   * Repeating the predicate pins THIS index - a bare `do nothing` would also
   * swallow a public_uuid collision, which should never be silent.
   */
  async addScheduled(params: AddScheduledAuditParams): Promise<AuditModel | null> {
    const row = await this.db
      .insertInto('audits')
      .values({
        page_id: params.pageId,
        url: params.url,
        status: 'queued',
        scheduled_for: params.scheduledFor,
      })
      .onConflict((oc) => oc.columns(['page_id', 'scheduled_for']).where('scheduled_for', 'is not', null).doNothing())
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? null : toAuditModel(row);
  }

  async loadByPublicUuid(publicUuid: string): Promise<AuditModel | null> {
    if (!UUID_PATTERN.test(publicUuid)) {
      return null;
    }

    const row = await this.db.selectFrom('audits').selectAll().where('public_uuid', '=', publicUuid).executeTakeFirst();

    return row === undefined ? null : toAuditModel(row);
  }

  async loadById(auditId: string): Promise<AuditModel | null> {
    const row = await this.db.selectFrom('audits').selectAll().where('id', '=', auditId).executeTakeFirst();

    return row === undefined ? null : toAuditModel(row);
  }

  async claimForRun(auditId: string): Promise<Date | null> {
    // Status alone is not mutual exclusion: under READ COMMITTED a second
    // delivery re-evaluates this after the first commits, so the status would
    // still match the row just claimed and both would run Chromium against it.
    // The lease is what makes it exclusive - a claim younger than
    // staleClaimAfterMs excludes everyone, an older one is reclaimable.
    const staleBefore = new Date(Date.now() - this.staleClaimAfterMs);
    // Kept rather than read back, so it can serve as this attempt's fence.
    const claimedAt = new Date();

    const claimed = await this.db
      .updateTable('audits')
      .set({status: 'running', claimed_at: claimedAt})
      .where('id', '=', auditId)
      .where((eb) =>
        eb.or([
          eb('status', '=', 'queued'),
          eb.and([
            eb('status', '=', 'running'),
            eb.or([eb('claimed_at', 'is', null), eb('claimed_at', '<', staleBefore)]),
          ]),
        ]),
      )
      .returning('id')
      .executeTakeFirst();

    return claimed === undefined ? null : claimedAt;
  }

  async releaseClaim(auditId: string, claimedAt: Date): Promise<void> {
    // Fenced on both the status and the exact claim: an attempt that has
    // already been superseded must not hand back a claim another attempt now
    // holds, and a finished audit must never be dragged back to `queued`.
    await this.db
      .updateTable('audits')
      .set({status: 'queued', claimed_at: null})
      .where('id', '=', auditId)
      .where('status', '=', 'running')
      .where('claimed_at', '=', claimedAt)
      .execute();
  }

  async complete(auditId: string, claimedAt: Date, result: CompleteAuditParams): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      // This update is the transaction's gate. If the claim was superseded,
      // the current attempt owns neither the result nor an alert derived from
      // it, so every read and insert below is skipped.
      const current = await writeDone(trx, auditId, claimedAt, result);
      if (current === undefined || current.page_id === null) {
        return;
      }

      const account = await trx
        .selectFrom('pages')
        .innerJoin('sites', 'sites.id', 'pages.site_id')
        .innerJoin('users', 'users.id', 'sites.user_id')
        .select(['users.alert_threshold', 'pages.alerts_enabled'])
        .where('pages.id', '=', current.page_id)
        .executeTakeFirstOrThrow();

      // Unsubscribe is alerts-only: daily audits and history continue, but no
      // new outbox event is created after the preference changes.
      if (!account.alerts_enabled) {
        return;
      }

      // "Previous" is chronological, not whichever audit happened to finish
      // most recently. Two jobs may complete out of order; allowing an audit
      // created later than this one into the baseline would compare time
      // backwards and can turn either an improvement or a regression around.
      const previous = await trx
        .selectFrom('audits')
        .select(['id', 'score', 'axe_version'])
        .where('page_id', '=', current.page_id)
        .where('status', '=', 'done')
        .where('score', 'is not', null)
        .where('axe_version', 'is not', null)
        .where(sql<SqlBool>`
          (audits.created_at, audits.id) <
          (${current.created_at}, ${auditId}::bigint)
        `)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();

      if (previous === undefined || previous.score === null || previous.axe_version === null) {
        return;
      }

      const previousViolations = await trx
        .selectFrom('violations')
        .select(['rule_id', 'impact'])
        .where('audit_id', '=', previous.id)
        .orderBy('id')
        .execute();

      const regression = detectRegression(
        {
          score: result.score,
          axeVersion: result.axeVersion,
          violations: result.violations,
        },
        {
          score: previous.score,
          axeVersion: previous.axe_version,
          violations: previousViolations.map((violation) => ({
            ruleId: violation.rule_id,
            impact: violation.impact,
          })),
        },
        account.alert_threshold,
      );

      if (regression.kind === 'none') {
        return;
      }

      // The expression is the existing unique index's exact target. `do
      // nothing` turns the expected race into a normal outcome without
      // swallowing foreign-key or check failures, and without aborting this
      // transaction (which would roll the successful completion back too).
      await trx
        .insertInto('alert_events')
        .values({
          page_id: current.page_id,
          audit_id: auditId,
          previous_audit_id: previous.id,
          kind: regression.kind,
        })
        .onConflict((oc) => oc.expression(sql`page_id, ((created_at at time zone 'UTC')::date)`).doNothing())
        .execute();
    });
  }

  async markFailed(auditId: string, claimedAt: Date, error: string): Promise<void> {
    await this.db
      .updateTable('audits')
      .set({status: 'failed', error, completed_at: new Date()})
      .where('id', '=', auditId)
      // Same fence: a resumed final attempt must not turn another worker's
      // successful audit into a failure.
      .where('status', '=', 'running')
      .where('claimed_at', '=', claimedAt)
      .execute();
  }

  async loadStaleInFlight(olderThan: Date, limit: number, after: StaleAudit | null): Promise<StaleAudit[]> {
    // Reads `audits_in_flight_created_idx`, which is partial on the two live
    // statuses and leads with `created_at` - so this walks the handful of
    // unfinished audits in order and stops at the limit, rather than reading
    // the whole live set and sorting it. The per-page index cannot serve this
    // query at all: with `page_id` unconstrained there is no ordered path
    // through it.
    let statement = this.db
      .selectFrom('audits')
      // `created_at` as TEXT, not as the parsed column. node-postgres turns a
      // timestamptz into a JavaScript Date, which holds milliseconds where
      // Postgres holds microseconds - so a cursor built from the parsed value
      // sits just below the row it came from, and the next batch serves that
      // row again. Letting the database render it keeps every digit.
      .select(['id', sql<string>`created_at::text`.as('cursor_at')])
      .where('status', 'in', ['queued', 'running'])
      .where('created_at', '<', olderThan)
      .orderBy('created_at')
      // The tiebreak the cursor needs. Two audits can share a timestamp -
      // `now()` is transaction time, so a fan-out's rows routinely do - and a
      // cursor that cannot tell them apart either repeats one or skips one.
      .orderBy('id')
      .limit(limit);

    if (after !== null) {
      // A row comparison, not two predicates: the `or` form is equivalent but
      // written so the planner cannot use the index. This matches its ordering.
      //
      // The timestamp goes back as the text Postgres produced, cast explicitly
      // for full precision. Raw SQL because the typed tuple builder demands the
      // column's PARSED type - a Date - which loses the microseconds this
      // cursor exists to keep.
      statement = statement.where(
        sql<SqlBool>`(created_at, id) > (${after.createdAt}::timestamptz, ${after.auditId}::bigint)`,
      );
    }

    const rows = await statement.execute();

    return rows.map((row) => ({auditId: row.id, createdAt: row.cursor_at}));
  }

  async markAbandoned(auditId: string, error: string): Promise<boolean> {
    const updated = await this.db
      .updateTable('audits')
      .set({status: 'failed', error, completed_at: new Date()})
      .where('id', '=', auditId)
      // Fenced on the audit still being unfinished. Between the caller
      // deciding this row is abandoned and this statement running, a worker
      // may have picked it up after all - and overwriting a real result with
      // "abandoned" would be worse than the stranded row this fixes.
      .where('status', 'in', ['queued', 'running'])
      .returning('id')
      .executeTakeFirst();

    return updated !== undefined;
  }

  async deleteIfQueued(auditId: string): Promise<void> {
    // The only delete on this repository, and scoped so it can never remove a
    // real audit: by the time anything is running or finished, somebody is
    // relying on it existing.
    await this.db.deleteFrom('audits').where('id', '=', auditId).where('status', '=', 'queued').execute();
  }
}
