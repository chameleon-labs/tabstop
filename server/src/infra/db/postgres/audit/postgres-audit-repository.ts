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
import type {
  AddOnDemandAuditParams,
  AddOnDemandAuditResult,
  AddOnDemandAuditRepository,
  ReleaseOnDemandAuditRepository,
} from '../../../../data/protocols/db/audit/add-on-demand-audit-repository.js';
import type {Database} from '../database.js';
import {detectRegression} from '../../../../domain/services/regression.js';
import {toAuditModel} from './audit-mapper.js';
import {isStorableId} from '../helpers/storable-id.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CLAIM_SAFETY_MARGIN_MS = 60_000;

export const claimLeaseFor = (jobTimeoutMs: number, unwindGraceMs: number): number =>
  jobTimeoutMs + unwindGraceMs + CLAIM_SAFETY_MARGIN_MS;

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
      counts_by_impact: JSON.stringify(result.countsByImpact),
      axe_version: result.axeVersion,
      duration_ms: result.durationMs,
      settled: result.settled,
      completed_at: new Date(),
    })
    .where('id', '=', auditId)
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
    ReclaimAbandonedAuditsRepository,
    AddOnDemandAuditRepository,
    ReleaseOnDemandAuditRepository
{
  constructor(
    private readonly db: Kysely<Database>,
    private readonly staleClaimAfterMs: number = DEFAULT_STALE_CLAIM_AFTER_MS,
  ) {}

  async add(params: AddAuditParams): Promise<AuditModel> {
    const row = await this.db
      .insertInto('audits')
      .values({url: params.url, page_id: params.pageId, status: 'queued'})
      .returningAll()
      .executeTakeFirstOrThrow();

    return toAuditModel(row);
  }

  async addScheduled(params: AddScheduledAuditParams): Promise<AuditModel | null> {
    return await this.db.transaction().execute(async (trx) => {
      const page = await trx
        .selectFrom('pages')
        .select('id')
        .where('id', '=', params.pageId)
        .where('monitoring_enabled', '=', true)
        .forUpdate()
        .executeTakeFirst();

      if (page === undefined) {
        return null;
      }

      const requested = await trx
        .selectFrom('audits')
        .innerJoin('on_demand_audits', 'on_demand_audits.audit_id', 'audits.id')
        .select('audits.id')
        .where('audits.page_id', '=', params.pageId)
        .where((eb) =>
          eb.or([
            sql<SqlBool>`on_demand_audits.spent_on = ${params.scheduledFor}::date`,
            eb('audits.status', 'in', ['queued', 'running']),
          ]),
        )
        .executeTakeFirst();

      if (requested !== undefined) {
        return null;
      }

      const row = await trx
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
    });
  }

  async addOnDemand(params: AddOnDemandAuditParams): Promise<AddOnDemandAuditResult> {
    if (!isStorableId(params.pageId) || !isStorableId(params.userId)) {
      return {outcome: 'not-found'};
    }

    return await this.db.transaction().execute(async (trx) => {
      const account = await trx
        .selectFrom('users')
        .select('id')
        .where('id', '=', params.userId)
        .forUpdate()
        .executeTakeFirst();

      if (account === undefined) {
        return {outcome: 'not-found'};
      }

      const page = await trx
        .selectFrom('pages')
        .select(['id', 'url'])
        .where('id', '=', params.pageId)
        .where('site_id', 'in', (eb) =>
          eb.selectFrom('sites').select('sites.id').where('sites.user_id', '=', params.userId),
        )
        .forUpdate()
        .executeTakeFirst();

      if (page === undefined) {
        return {outcome: 'not-found'};
      }

      const inFlight = await trx
        .selectFrom('audits')
        .select('id')
        .where('page_id', '=', params.pageId)
        .where('status', 'in', ['queued', 'running'])
        .executeTakeFirst();

      if (inFlight !== undefined) {
        return {outcome: 'in-flight'};
      }

      const spent = await trx
        .selectFrom('on_demand_audits')
        .select(({fn}) => fn.countAll<string>().as('count'))
        .where('user_id', '=', params.userId)
        .where(sql<SqlBool>`spent_on = ${params.day}::date`)
        .executeTakeFirstOrThrow();

      if (Number(spent.count) >= params.allowance) {
        return {outcome: 'allowance-spent'};
      }

      const row = await trx
        .insertInto('audits')
        .values({
          page_id: params.pageId,
          url: page.url,
          status: 'queued',
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('on_demand_audits')
        .values({user_id: params.userId, spent_on: params.day, audit_id: row.id})
        .execute();

      return {outcome: 'added', audit: toAuditModel(row)};
    });
  }

  async releaseOnDemand(auditId: string): Promise<void> {
    if (!isStorableId(auditId)) {
      return;
    }

    await this.db.transaction().execute(async (trx) => {
      const audit = await trx
        .selectFrom('audits')
        .select('id')
        .where('id', '=', auditId)
        .where('status', '=', 'queued')
        .forUpdate()
        .executeTakeFirst();

      if (audit === undefined) {
        return;
      }

      await trx.deleteFrom('on_demand_audits').where('audit_id', '=', auditId).execute();
      await trx.deleteFrom('audits').where('id', '=', auditId).execute();
    });
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
    const staleBefore = new Date(Date.now() - this.staleClaimAfterMs);
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

      if (!account.alerts_enabled) {
        return;
      }

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
      .where('status', '=', 'running')
      .where('claimed_at', '=', claimedAt)
      .execute();
  }

  async loadStaleInFlight(olderThan: Date, limit: number, after: StaleAudit | null): Promise<StaleAudit[]> {
    let statement = this.db
      .selectFrom('audits')
      .select(['id', sql<string>`created_at::text`.as('cursor_at')])
      .where('status', 'in', ['queued', 'running'])
      .where('created_at', '<', olderThan)
      .orderBy('created_at')
      .orderBy('id')
      .limit(limit);

    if (after !== null) {
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
      .where('status', 'in', ['queued', 'running'])
      .returning('id')
      .executeTakeFirst();

    return updated !== undefined;
  }

  async deleteIfQueued(auditId: string): Promise<void> {
    await this.db.deleteFrom('audits').where('id', '=', auditId).where('status', '=', 'queued').execute();
  }
}
