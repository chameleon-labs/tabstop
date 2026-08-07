import type {Kysely} from 'kysely';
import type {
  AlertDelivery,
  AlertViolation,
  LoadAlertDeliveryRepository,
} from '../../../../data/protocols/db/alert-event/load-alert-delivery-repository.js';
import type {
  AlertDispatchMode,
  LoadPendingAlertEventsRepository,
} from '../../../../data/protocols/db/alert-event/load-pending-alert-events-repository.js';
import type {MarkAlertEmailedRepository} from '../../../../data/protocols/db/alert-event/mark-alert-emailed-repository.js';
import type {ClaimAlertPreviewRepository} from '../../../../data/protocols/db/alert-event/claim-alert-preview-repository.js';
import type {MarkAlertFailedRepository} from '../../../../data/protocols/db/alert-event/mark-alert-failed-repository.js';
import type {DisablePageAlertsRepository} from '../../../../data/protocols/db/alert-event/disable-page-alerts-repository.js';
import type {Database} from '../database.js';

export class PostgresAlertEventRepository
  implements
    LoadAlertDeliveryRepository,
    LoadPendingAlertEventsRepository,
    MarkAlertEmailedRepository,
    ClaimAlertPreviewRepository,
    MarkAlertFailedRepository,
    DisablePageAlertsRepository
{
  constructor(private readonly db: Kysely<Database>) {}

  async loadPendingAlertEventIds(afterId: string | null, limit: number, mode: AlertDispatchMode): Promise<string[]> {
    let query = this.db
      .selectFrom('alert_events')
      .innerJoin('pages', 'pages.id', 'alert_events.page_id')
      .select('alert_events.id')
      .where('alert_events.emailed_at', 'is', null)
      .where('alert_events.failed_at', 'is', null)
      // Unsubscribe intentionally cancels pending delivery without falsifying
      // emailed_at. Excluding it here keeps the retained event as history
      // without redispatching a job every minute forever.
      .where('pages.alerts_enabled', '=', true)
      .orderBy('alert_events.id')
      .limit(limit);

    if (mode === 'preview') query = query.where('alert_events.previewed_at', 'is', null);
    if (afterId !== null) query = query.where('alert_events.id', '>', afterId);

    return (await query.execute()).map(({id}) => id);
  }

  async loadAlertDelivery(alertEventId: string): Promise<AlertDelivery | null> {
    const row = await this.db
      .selectFrom('alert_events')
      .innerJoin('pages', 'pages.id', 'alert_events.page_id')
      .innerJoin('sites', 'sites.id', 'pages.site_id')
      .innerJoin('users', 'users.id', 'sites.user_id')
      .innerJoin('audits as current_audit', 'current_audit.id', 'alert_events.audit_id')
      .innerJoin('audits as previous_audit', 'previous_audit.id', 'alert_events.previous_audit_id')
      .select([
        'alert_events.id as event_id',
        'alert_events.kind',
        'alert_events.emailed_at',
        'alert_events.previewed_at',
        'alert_events.failed_at',
        'pages.id as page_id',
        'pages.url as page_url',
        'pages.alerts_enabled',
        'users.email as recipient',
        'current_audit.public_uuid as current_public_uuid',
        'current_audit.score as current_score',
        'previous_audit.score as previous_score',
        'current_audit.id as current_audit_id',
        'previous_audit.id as previous_audit_id',
      ])
      .where('alert_events.id', '=', alertEventId)
      .executeTakeFirst();

    if (row === undefined) return null;
    if (row.current_score === null || row.previous_score === null) {
      throw new Error(`Alert event ${alertEventId} refers to an audit without a score`);
    }

    const [currentViolations, previousViolations] = await Promise.all([
      this.loadViolations(row.current_audit_id),
      this.loadViolations(row.previous_audit_id),
    ]);

    return {
      eventId: row.event_id,
      pageId: row.page_id,
      kind: row.kind,
      recipient: row.recipient,
      pageUrl: row.page_url,
      current: {
        publicUuid: row.current_public_uuid,
        score: row.current_score,
        violations: currentViolations,
      },
      previous: {
        score: row.previous_score,
        violations: previousViolations,
      },
      alertsEnabled: row.alerts_enabled,
      emailedAt: row.emailed_at,
      previewedAt: row.previewed_at,
      failedAt: row.failed_at,
    };
  }

  async markAlertEmailed(alertEventId: string, emailedAt: Date): Promise<boolean> {
    const row = await this.db
      .updateTable('alert_events')
      .set({emailed_at: emailedAt})
      .where('id', '=', alertEventId)
      .where('emailed_at', 'is', null)
      .where('failed_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }

  async claimAlertPreview(alertEventId: string, claimedAt: Date): Promise<boolean> {
    const row = await this.db
      .updateTable('alert_events')
      .set({previewed_at: claimedAt})
      .where('id', '=', alertEventId)
      .where('previewed_at', 'is', null)
      .where('emailed_at', 'is', null)
      .where('failed_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }

  async markAlertFailed(alertEventId: string, failedAt: Date, failureReason: string): Promise<boolean> {
    const row = await this.db
      .updateTable('alert_events')
      .set({failed_at: failedAt, failure_reason: failureReason})
      .where('id', '=', alertEventId)
      .where('emailed_at', 'is', null)
      .where('failed_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }

  async disablePageAlerts(pageId: string): Promise<boolean> {
    const row = await this.db
      .updateTable('pages')
      .set({alerts_enabled: false})
      .where('id', '=', pageId)
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }

  private async loadViolations(auditId: string): Promise<AlertViolation[]> {
    const rows = await this.db
      .selectFrom('violations')
      .select(['rule_id', 'impact', 'description', 'nodes'])
      .where('audit_id', '=', auditId)
      .orderBy('id')
      .execute();

    return rows.map((row) => ({
      ruleId: row.rule_id,
      impact: row.impact,
      description: row.description,
      nodeCount: row.nodes.length,
    }));
  }
}
