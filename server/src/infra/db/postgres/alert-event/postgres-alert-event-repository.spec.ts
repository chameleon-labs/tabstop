import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {Kysely} from 'kysely';
import type {Database} from '../database.js';
import {makeDatabase} from '../helpers/postgres-helper.js';
import {PostgresAlertEventRepository} from './postgres-alert-event-repository.js';

describe('PostgresAlertEventRepository', () => {
  let db: Kysely<Database>;
  let sut: PostgresAlertEventRepository;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) {
      throw new Error('DATABASE_URL not set by globalSetup');
    }
    db = makeDatabase(url);
    sut = new PostgresAlertEventRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const fixture = async () => {
    const user = await db
      .insertInto('users')
      .values({
        email: `${randomUUID()}@test.test`,
        password_digest: 'x',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const site = await db
      .insertInto('sites')
      .values({
        user_id: user.id,
        domain: `${randomUUID()}.test`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const page = await db
      .insertInto('pages')
      .values({
        site_id: site.id,
        url: 'https://example.test/checkout',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const previous = await db
      .insertInto('audits')
      .values({
        page_id: page.id,
        url: 'https://example.test/checkout',
        status: 'done',
        score: 84,
        axe_version: '4.12.1',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const current = await db
      .insertInto('audits')
      .values({
        page_id: page.id,
        url: 'https://example.test/checkout',
        status: 'done',
        score: 72,
        axe_version: '4.12.1',
      })
      .returning(['id', 'public_uuid'])
      .executeTakeFirstOrThrow();
    await db
      .insertInto('violations')
      .values([
        {
          audit_id: previous.id,
          rule_id: 'label',
          impact: 'serious',
          description: 'Form elements must have labels',
          help_url: 'https://example.test/label',
          nodes: JSON.stringify([{target: ['#old'], html: '<input>'}]),
        },
        {
          audit_id: current.id,
          rule_id: 'label',
          impact: 'critical',
          description: 'Form elements must have labels',
          help_url: 'https://example.test/label',
          nodes: JSON.stringify([
            {target: ['#a'], html: '<input>'},
            {target: ['#b'], html: '<input>'},
          ]),
        },
      ])
      .execute();
    const event = await db
      .insertInto('alert_events')
      .values({
        page_id: page.id,
        audit_id: current.id,
        previous_audit_id: previous.id,
        kind: 'score_drop',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return {user, page, previous, current, event};
  };

  it('loads the immutable comparison and current delivery preference', async () => {
    const rows = await fixture();

    await expect(sut.loadAlertDelivery(rows.event.id)).resolves.toEqual({
      eventId: rows.event.id,
      pageId: rows.page.id,
      kind: 'score_drop',
      recipient: expect.stringMatching(/@test\.test$/),
      pageUrl: 'https://example.test/checkout',
      current: {
        publicUuid: rows.current.public_uuid,
        score: 72,
        violations: [
          {
            ruleId: 'label',
            impact: 'critical',
            description: 'Form elements must have labels',
            nodeCount: 2,
          },
        ],
      },
      previous: {
        score: 84,
        violations: [
          {
            ruleId: 'label',
            impact: 'serious',
            description: 'Form elements must have labels',
            nodeCount: 1,
          },
        ],
      },
      alertsEnabled: true,
      emailedAt: null,
      previewedAt: null,
      failedAt: null,
    });
  });

  it('walks delivery-pending ids with a keyset cursor', async () => {
    const first = await fixture();
    const second = await fixture();
    await db.updateTable('alert_events').set({emailed_at: new Date()}).where('id', '=', first.event.id).execute();

    const beforeFirst = String(BigInt(first.event.id) - 1n);
    const pending = await sut.loadPendingAlertEventIds(beforeFirst, 100, 'delivery');
    expect(pending).toContain(second.event.id);
    expect(pending).not.toContain(first.event.id);

    const afterSecond = await sut.loadPendingAlertEventIds(second.event.id, 100, 'delivery');
    expect(afterSecond.every((id) => BigInt(id) > BigInt(second.event.id))).toBe(true);
  });

  it('selects pending alerts according to dispatch mode and retains failures until reset', async () => {
    const previewedEvent = await fixture();
    const failedEvent = await fixture();

    expect(await sut.claimAlertPreview(previewedEvent.event.id, new Date('2026-07-30T10:00:00Z'))).toBe(true);
    expect(
      await sut.markAlertFailed(failedEvent.event.id, new Date('2026-07-30T10:05:00Z'), 'recipient address rejected'),
    ).toBe(true);

    expect(await sut.loadPendingAlertEventIds(null, 100, 'preview')).not.toContain(previewedEvent.event.id);
    expect(await sut.loadPendingAlertEventIds(null, 100, 'delivery')).toContain(previewedEvent.event.id);
    expect(await sut.loadPendingAlertEventIds(null, 100, 'delivery')).not.toContain(failedEvent.event.id);

    await db
      .updateTable('alert_events')
      .set({failed_at: null, failure_reason: null})
      .where('id', '=', failedEvent.event.id)
      .execute();

    expect(await sut.loadPendingAlertEventIds(null, 100, 'delivery')).toContain(failedEvent.event.id);
  });

  it('claims previews once and never rewrites their first recorded time', async () => {
    const {event} = await fixture();
    const first = new Date('2026-07-30T10:00:00Z');
    const second = new Date('2026-07-30T11:00:00Z');

    expect(await sut.claimAlertPreview(event.id, first)).toBe(true);
    expect(await sut.claimAlertPreview(event.id, second)).toBe(false);

    const stored = await db
      .selectFrom('alert_events')
      .select('previewed_at')
      .where('id', '=', event.id)
      .executeTakeFirstOrThrow();
    expect(stored.previewed_at).toEqual(first);
  });

  it('refuses a preview claim after real delivery completed', async () => {
    const {event} = await fixture();
    const deliveredAt = new Date('2026-07-30T10:00:00Z');

    expect(await sut.markAlertEmailed(event.id, deliveredAt)).toBe(true);
    expect(await sut.claimAlertPreview(event.id, new Date('2026-07-30T10:01:00Z'))).toBe(false);

    expect(
      await db
        .selectFrom('alert_events')
        .select(['emailed_at', 'previewed_at'])
        .where('id', '=', event.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({emailed_at: deliveredAt, previewed_at: null});
  });

  it('marks permanent failures once and prevents a failure from being emailed', async () => {
    const {event} = await fixture();
    const first = new Date('2026-07-30T10:00:00Z');
    const second = new Date('2026-07-30T11:00:00Z');
    const failureReason = 'resend:451:unavailable_for_legal_reasons';

    expect(await sut.markAlertFailed(event.id, first, failureReason)).toBe(true);
    expect(await sut.markAlertFailed(event.id, second, 'retry must not overwrite')).toBe(false);
    expect(await sut.markAlertEmailed(event.id, second)).toBe(false);

    const stored = await db
      .selectFrom('alert_events')
      .select(['emailed_at', 'failed_at', 'failure_reason'])
      .where('id', '=', event.id)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({
      emailed_at: null,
      failed_at: first,
      failure_reason: failureReason,
    });
  });

  it('marks delivery once and never rewrites its first confirmed time', async () => {
    const {event} = await fixture();
    const first = new Date('2026-07-30T10:00:00Z');
    const second = new Date('2026-07-30T11:00:00Z');

    expect(await sut.markAlertEmailed(event.id, first)).toBe(true);
    expect(await sut.markAlertEmailed(event.id, second)).toBe(false);

    const stored = await db
      .selectFrom('alert_events')
      .select('emailed_at')
      .where('id', '=', event.id)
      .executeTakeFirstOrThrow();
    expect(stored.emailed_at).toEqual(first);
  });

  it('disables only mail alerts and leaves daily monitoring enabled', async () => {
    const {page, event} = await fixture();

    expect(await sut.disablePageAlerts(page.id)).toBe(true);
    expect(await sut.disablePageAlerts(page.id)).toBe(true);

    const stored = await db
      .selectFrom('pages')
      .select(['alerts_enabled', 'monitoring_enabled'])
      .where('id', '=', page.id)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({alerts_enabled: false, monitoring_enabled: true});
    expect(await sut.loadPendingAlertEventIds(String(BigInt(event.id) - 1n), 100, 'delivery')).not.toContain(event.id);
  });
});
