import type {Kysely} from 'kysely';
import type {AuditModel} from '../../../../domain/models/audit.js';
import type {PageModel, PageScorePoint, PageSummary} from '../../../../domain/models/page.js';
import type {
  AddPageRepository,
  AddPageRepositoryParams,
  AddPageRepositoryResult,
} from '../../../../data/protocols/db/page/add-page-repository.js';
import type {LoadPageSummariesRepository} from '../../../../data/protocols/db/page/load-page-summaries-repository.js';
import type {SetPageMonitoringRepository} from '../../../../data/protocols/db/page/set-page-monitoring-repository.js';
import type {DeletePageRepository} from '../../../../data/protocols/db/page/delete-page-repository.js';
import type {
  DuePage,
  DuePageQuery,
  LoadDueReauditsRepository,
} from '../../../../data/protocols/db/page/load-due-reaudits-repository.js';
import type {LoadPageHistoryRepository} from '../../../../data/protocols/db/page/load-page-history-repository.js';
import type {PageHistory} from '../../../../domain/usecases/load-page-history.js';
import type {Database} from '../database.js';
import {isStorableId} from '../helpers/storable-id.js';
import {toAuditModel} from '../audit/audit-mapper.js';
import {toPageModel} from './page-mapper.js';

export const HISTORY_POINTS = 30;

export class PostgresPageRepository
  implements
    AddPageRepository,
    LoadDueReauditsRepository,
    LoadPageSummariesRepository,
    LoadPageHistoryRepository,
    SetPageMonitoringRepository,
    DeletePageRepository
{
  constructor(private readonly db: Kysely<Database>) {}

  async add(params: AddPageRepositoryParams): Promise<AddPageRepositoryResult> {
    return await this.db.transaction().execute(async (trx) => {
      await trx.selectFrom('users').select('id').where('id', '=', params.userId).forUpdate().executeTakeFirstOrThrow();

      const existing = await trx
        .selectFrom('pages')
        .innerJoin('sites', 'sites.id', 'pages.site_id')
        .select('pages.id')
        .where('sites.user_id', '=', params.userId)
        .where('pages.url', '=', params.url)
        .executeTakeFirst();

      if (existing !== undefined) {
        return {outcome: 'duplicate'};
      }

      const counted = await trx
        .selectFrom('pages')
        .innerJoin('sites', 'sites.id', 'pages.site_id')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('sites.user_id', '=', params.userId)
        .executeTakeFirstOrThrow();

      if (Number(counted.count) >= params.limit) {
        return {outcome: 'limit-reached'};
      }

      const siteId = await this.findOrCreateSite(trx, params.userId, params.domain);

      const page = await trx
        .insertInto('pages')
        .values({site_id: siteId, url: params.url})
        .onConflict((oc) => oc.constraint('pages_site_id_url_unique').doNothing())
        .returningAll()
        .executeTakeFirst();

      if (page === undefined) {
        return {outcome: 'duplicate'};
      }

      const audit = await trx
        .insertInto('audits')
        .values({url: params.url, page_id: page.id, status: 'queued'})
        .returningAll()
        .executeTakeFirstOrThrow();

      return {outcome: 'added', page: toPageModel(page), firstAudit: toAuditModel(audit)};
    });
  }

  async loadDueForReaudit(query: DuePageQuery): Promise<DuePage[]> {
    let statement = this.db
      .selectFrom('pages')
      .innerJoin('sites', 'sites.id', 'pages.site_id')
      .select(['pages.id as page_id', 'pages.url', 'sites.domain'])
      .where('pages.monitoring_enabled', '=', true)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('audits')
              .select('audits.id')
              .whereRef('audits.page_id', '=', 'pages.id')
              .where('audits.status', 'in', ['queued', 'running']),
          ),
        ),
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('audits')
              .select('audits.id')
              .whereRef('audits.page_id', '=', 'pages.id')
              .where('audits.created_at', '>=', query.dayStart),
          ),
        ),
      )
      .orderBy('pages.id')
      .limit(query.limit);

    if (query.after !== null) {
      statement = statement.where('pages.id', '>', query.after);
    }

    const rows = await statement.execute();

    return rows.map((row) => ({pageId: row.page_id, url: row.url, domain: row.domain}));
  }

  async loadSummariesForUser(userId: string): Promise<PageSummary[]> {
    const pageRows = await this.db
      .selectFrom('pages')
      .innerJoin('sites', 'sites.id', 'pages.site_id')
      .select([
        'pages.id',
        'pages.site_id',
        'pages.url',
        'pages.monitoring_enabled',
        'pages.alerts_enabled',
        'pages.created_at',
        'sites.domain',
      ])
      .where('sites.user_id', '=', userId)
      .orderBy('pages.created_at')
      .orderBy('pages.id')
      .execute();

    if (pageRows.length === 0) {
      return [];
    }

    const pageIds = pageRows.map((row) => row.id);
    const [latest, history] = await Promise.all([this.loadLatestAudits(pageIds), this.loadRecentScores(pageIds)]);

    return pageRows.map((row) => ({
      page: toPageModel(row),
      domain: row.domain,
      latestAudit: latest.get(row.id) ?? null,
      history: history.get(row.id) ?? [],
    }));
  }

  async loadHistoryForUser(pageId: string, userId: string, since: Date): Promise<PageHistory | null> {
    if (!isStorableId(pageId)) {
      return null;
    }

    const page = await this.db
      .selectFrom('pages')
      .selectAll('pages')
      .where('pages.id', '=', pageId)
      .where('pages.site_id', 'in', (eb) =>
        eb.selectFrom('sites').select('sites.id').where('sites.user_id', '=', userId),
      )
      .executeTakeFirst();

    if (page === undefined) {
      return null;
    }

    const audits = await this.db
      .selectFrom('audits')
      .selectAll()
      .where('page_id', '=', pageId)
      .where('created_at', '>=', since)
      .orderBy('created_at')
      .execute();

    return {page: toPageModel(page), audits: audits.map(toAuditModel)};
  }

  async setMonitoringForUser(pageId: string, userId: string, monitoringEnabled: boolean): Promise<PageModel | null> {
    if (!isStorableId(pageId)) {
      return null;
    }

    return await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('pages')
        .set({monitoring_enabled: monitoringEnabled})
        .where('id', '=', pageId)
        .where('site_id', 'in', (eb) => eb.selectFrom('sites').select('sites.id').where('sites.user_id', '=', userId))
        .returningAll()
        .executeTakeFirst();

      if (updated === undefined) {
        return null;
      }

      if (!monitoringEnabled) {
        await trx
          .deleteFrom('audits')
          .where('page_id', '=', pageId)
          .where('status', '=', 'queued')
          .where('scheduled_for', 'is not', null)
          .execute();
      }

      return toPageModel(updated);
    });
  }

  async deleteForUser(pageId: string, userId: string): Promise<boolean> {
    if (!isStorableId(pageId)) {
      return false;
    }

    const deleted = await this.db
      .deleteFrom('pages')
      .where('id', '=', pageId)
      .where('site_id', 'in', (eb) => eb.selectFrom('sites').select('sites.id').where('sites.user_id', '=', userId))
      .returning('id')
      .executeTakeFirst();

    return deleted !== undefined;
  }

  private async findOrCreateSite(trx: Kysely<Database>, userId: string, domain: string): Promise<string> {
    const existing = await trx
      .selectFrom('sites')
      .select('id')
      .where('user_id', '=', userId)
      .where('domain', '=', domain)
      .executeTakeFirst();

    if (existing !== undefined) {
      return existing.id;
    }

    const inserted = await trx
      .insertInto('sites')
      .values({user_id: userId, domain})
      .onConflict((oc) => oc.constraint('sites_user_domain_unique').doNothing())
      .returning('id')
      .executeTakeFirst();

    if (inserted !== undefined) {
      return inserted.id;
    }

    const won = await trx
      .selectFrom('sites')
      .select('id')
      .where('user_id', '=', userId)
      .where('domain', '=', domain)
      .executeTakeFirstOrThrow();

    return won.id;
  }

  private async loadLatestAudits(pageIds: string[]): Promise<Map<string, AuditModel>> {
    const rows = await this.db
      .selectFrom('audits')
      .distinctOn('page_id')
      .selectAll()
      .where('page_id', 'in', pageIds)
      .orderBy('page_id')
      .orderBy('created_at', 'desc')
      .execute();

    const byPage = new Map<string, AuditModel>();
    for (const row of rows) {
      if (row.page_id === null) {
        continue;
      }
      byPage.set(row.page_id, toAuditModel(row));
    }
    return byPage;
  }

  private async loadRecentScores(pageIds: string[]): Promise<Map<string, PageScorePoint[]>> {
    const rows = await this.db
      .selectFrom('pages')
      .where('pages.id', 'in', pageIds)
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('audits')
            .select(['audits.page_id', 'audits.score', 'audits.created_at'])
            .whereRef('audits.page_id', '=', 'pages.id')
            .where('audits.status', '=', 'done')
            .where('audits.score', 'is not', null)
            .orderBy('audits.created_at', 'desc')
            .limit(HISTORY_POINTS)
            .as('recent'),
        (join) => join.onTrue(),
      )
      .select(['recent.page_id', 'recent.score', 'recent.created_at'])
      .orderBy('recent.page_id')
      .orderBy('recent.created_at')
      .execute();

    const byPage = new Map<string, PageScorePoint[]>();
    for (const row of rows) {
      if (row.page_id === null || row.score === null) {
        continue;
      }
      const points = byPage.get(row.page_id) ?? [];
      points.push({score: row.score, at: row.created_at});
      byPage.set(row.page_id, points);
    }
    return byPage;
  }
}
