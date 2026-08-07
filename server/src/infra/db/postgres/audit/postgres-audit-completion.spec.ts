import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {Kysely} from 'kysely';
import type {Impact} from '../../../../domain/models/impact.js';
import type {Database} from '../database.js';
import {makeDatabase} from '../helpers/postgres-helper.js';
import {PostgresAuditRepository} from './postgres-audit-repository.js';

type SnapshotViolation = {
  ruleId: string;
  impact: Impact | null;
};

type AuditFixture = {
  id: string;
  createdAt: Date;
};

const counts = {minor: 0, moderate: 0, serious: 0, critical: 0};

describe('PostgresAuditRepository completion', () => {
  let db: Kysely<Database>;
  let sut: PostgresAuditRepository;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) {
      throw new Error('DATABASE_URL not set by globalSetup');
    }
    db = makeDatabase(url);
    sut = new PostgresAuditRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const makePage = async (alertThreshold = 5): Promise<string> => {
    const user = await db
      .insertInto('users')
      .values({
        email: `${randomUUID()}@test.test`,
        password_digest: 'x',
        alert_threshold: alertThreshold,
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
        url: `https://${randomUUID()}.test/a`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return page.id;
  };

  const storeViolations = async (auditId: string, violations: readonly SnapshotViolation[]): Promise<void> => {
    if (violations.length === 0) {
      return;
    }

    await db
      .insertInto('violations')
      .values(
        violations.map((violation) => ({
          audit_id: auditId,
          rule_id: violation.ruleId,
          impact: violation.impact,
          description: `${violation.ruleId} description`,
          help_url: `https://example.test/${violation.ruleId}`,
          nodes: JSON.stringify([]),
        })),
      )
      .execute();
  };

  const doneAudit = async (
    pageId: string,
    params: {
      score: number;
      axeVersion?: string;
      createdAt: Date;
      violations?: readonly SnapshotViolation[];
    },
  ): Promise<AuditFixture> => {
    const row = await db
      .insertInto('audits')
      .values({
        page_id: pageId,
        url: `https://${randomUUID()}.test/a`,
        status: 'done',
        score: params.score,
        axe_version: params.axeVersion ?? '4.12.1',
        completed_at: params.createdAt,
        created_at: params.createdAt,
      })
      .returning(['id', 'created_at'])
      .executeTakeFirstOrThrow();
    await storeViolations(row.id, params.violations ?? []);
    return {id: row.id, createdAt: row.created_at};
  };

  const failedAudit = async (pageId: string, createdAt: Date): Promise<void> => {
    await db
      .insertInto('audits')
      .values({
        page_id: pageId,
        url: `https://${randomUUID()}.test/a`,
        status: 'failed',
        // Deliberately poison the row with a score/version. Production does not
        // write them on failure, but status is the contract: a query that merely
        // filters null scores would pass the happy schema by coincidence and
        // silently regress if stale result fields ever survived a retry.
        score: 0,
        axe_version: '4.12.1',
        error: 'Could not load that page',
        completed_at: createdAt,
        created_at: createdAt,
      })
      .execute();
  };

  const claimedAudit = async (pageId: string | null, createdAt: Date): Promise<{id: string; claimedAt: Date}> => {
    const row = await db
      .insertInto('audits')
      .values({
        page_id: pageId,
        url: `https://${randomUUID()}.test/a`,
        status: 'queued',
        created_at: createdAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const claimedAt = await sut.claimForRun(row.id);
    if (claimedAt === null) {
      throw new Error('fixture failed to claim audit');
    }
    return {id: row.id, claimedAt};
  };

  const complete = async (
    audit: {id: string; claimedAt: Date},
    params: {
      score: number;
      axeVersion?: string;
      violations?: readonly SnapshotViolation[];
    },
  ): Promise<void> => {
    const violations = params.violations ?? [];
    await storeViolations(audit.id, violations);
    await sut.complete(audit.id, audit.claimedAt, {
      score: params.score,
      countsByImpact: counts,
      axeVersion: params.axeVersion ?? '4.12.1',
      durationMs: 10,
      settled: true,
      violations,
    });
  };

  const alertsFor = async (pageId: string) =>
    await db.selectFrom('alert_events').selectAll().where('page_id', '=', pageId).orderBy('id').execute();

  it('completes a first audit without creating an alert', async () => {
    const pageId = await makePage();
    const current = await claimedAudit(pageId, new Date('2026-01-02T10:00:00Z'));

    await complete(current, {score: 40});

    const stored = await db.selectFrom('audits').selectAll().where('id', '=', current.id).executeTakeFirstOrThrow();
    expect(stored.status).toBe('done');
    expect(stored.score).toBe(40);
    expect(await alertsFor(pageId)).toEqual([]);
  });

  it('records a score drop at the account threshold and links both audits', async () => {
    const pageId = await makePage(7);
    const previous = await doneAudit(pageId, {
      score: 90,
      createdAt: new Date('2026-01-01T10:00:00Z'),
    });
    const current = await claimedAudit(pageId, new Date('2026-01-02T10:00:00Z'));

    await complete(current, {score: 83});

    expect(await alertsFor(pageId)).toMatchObject([
      {
        page_id: pageId,
        audit_id: current.id,
        previous_audit_id: previous.id,
        kind: 'score_drop',
        emailed_at: null,
      },
    ]);
  });

  it('records a new severe rule even when the score is flat', async () => {
    const pageId = await makePage();
    const previous = await doneAudit(pageId, {
      score: 90,
      createdAt: new Date('2026-01-01T10:00:00Z'),
      violations: [{ruleId: 'label', impact: 'minor'}],
    });
    const current = await claimedAudit(pageId, new Date('2026-01-02T10:00:00Z'));

    await complete(current, {
      score: 90,
      violations: [
        {ruleId: 'label', impact: 'minor'},
        {ruleId: 'image-alt', impact: 'critical'},
      ],
    });

    expect(await alertsFor(pageId)).toMatchObject([
      {
        audit_id: current.id,
        previous_audit_id: previous.id,
        kind: 'new_critical',
      },
    ]);
  });

  it('does not create new alert events after email alerts are disabled', async () => {
    const pageId = await makePage();
    await db.updateTable('pages').set({alerts_enabled: false}).where('id', '=', pageId).execute();
    await doneAudit(pageId, {
      score: 90,
      createdAt: new Date('2026-01-01T10:00:00Z'),
    });
    const current = await claimedAudit(pageId, new Date('2026-01-02T10:00:00Z'));

    await complete(current, {score: 20});

    expect(await alertsFor(pageId)).toEqual([]);
    expect(
      await db.selectFrom('pages').select('monitoring_enabled').where('id', '=', pageId).executeTakeFirstOrThrow(),
    ).toEqual({monitoring_enabled: true});
  });

  it('skips a failed audit when choosing the previous completed audit', async () => {
    const pageId = await makePage();
    const previous = await doneAudit(pageId, {
      score: 90,
      createdAt: new Date('2026-01-01T10:00:00Z'),
    });
    await failedAudit(pageId, new Date('2026-01-02T10:00:00Z'));
    const current = await claimedAudit(pageId, new Date('2026-01-03T10:00:00Z'));

    await complete(current, {score: 85});

    expect(await alertsFor(pageId)).toMatchObject([
      {
        audit_id: current.id,
        previous_audit_id: previous.id,
        kind: 'score_drop',
      },
    ]);
  });

  it('does not compare against a completed audit created after the current one', async () => {
    const pageId = await makePage();
    const previous = await doneAudit(pageId, {
      score: 90,
      createdAt: new Date('2026-01-01T10:00:00Z'),
    });
    await doneAudit(pageId, {
      score: 10,
      createdAt: new Date('2026-01-03T10:00:00Z'),
    });
    const current = await claimedAudit(pageId, new Date('2026-01-02T10:00:00Z'));

    await complete(current, {score: 85});

    expect(await alertsFor(pageId)).toMatchObject([
      {
        audit_id: current.id,
        previous_audit_id: previous.id,
        kind: 'score_drop',
      },
    ]);
  });

  it('suppresses a regression across an axe version change', async () => {
    const pageId = await makePage();
    await doneAudit(pageId, {
      score: 90,
      axeVersion: '4.12.1',
      createdAt: new Date('2026-01-01T10:00:00Z'),
    });
    const current = await claimedAudit(pageId, new Date('2026-01-02T10:00:00Z'));

    await complete(current, {
      score: 20,
      axeVersion: '4.13.0',
      violations: [{ruleId: 'new-rule', impact: 'critical'}],
    });

    expect(await alertsFor(pageId)).toEqual([]);
  });

  it('completes an anonymous audit without looking for an alert', async () => {
    const current = await claimedAudit(null, new Date('2026-01-02T10:00:00Z'));

    await complete(current, {
      score: 0,
      violations: [{ruleId: 'image-alt', impact: 'critical'}],
    });

    const stored = await db
      .selectFrom('audits')
      .select('status')
      .where('id', '=', current.id)
      .executeTakeFirstOrThrow();
    expect(stored.status).toBe('done');
    expect(await db.selectFrom('alert_events').select('id').where('audit_id', '=', current.id).execute()).toEqual([]);
  });

  it('writes neither completion nor alert after the attempt loses its claim', async () => {
    const pageId = await makePage();
    await doneAudit(pageId, {
      score: 90,
      createdAt: new Date('2026-01-01T10:00:00Z'),
    });
    const current = await claimedAudit(pageId, new Date('2026-01-02T10:00:00Z'));

    await sut.complete(current.id, new Date(current.claimedAt.getTime() - 1), {
      score: 10,
      countsByImpact: counts,
      axeVersion: '4.12.1',
      durationMs: 10,
      settled: true,
      violations: [{ruleId: 'image-alt', impact: 'critical'}],
    });

    const stored = await db
      .selectFrom('audits')
      .select('status')
      .where('id', '=', current.id)
      .executeTakeFirstOrThrow();
    expect(stored.status).toBe('running');
    expect(await alertsFor(pageId)).toEqual([]);
  });

  it('treats a second regression on the same UTC day as a normal no-op', async () => {
    const pageId = await makePage();
    await doneAudit(pageId, {
      score: 100,
      createdAt: new Date('2026-01-01T10:00:00Z'),
    });
    const first = await claimedAudit(pageId, new Date('2026-01-02T10:00:00Z'));
    await complete(first, {score: 90});
    const second = await claimedAudit(pageId, new Date('2026-01-03T10:00:00Z'));

    await expect(complete(second, {score: 80})).resolves.toBeUndefined();

    expect(await alertsFor(pageId)).toHaveLength(1);
    const stored = await db.selectFrom('audits').select('status').where('id', '=', second.id).executeTakeFirstOrThrow();
    expect(stored.status).toBe('done');
  });

  it('allows the same page to alert again on a later UTC day', async () => {
    const pageId = await makePage();
    await doneAudit(pageId, {
      score: 100,
      createdAt: new Date('2026-01-01T10:00:00Z'),
    });
    const first = await claimedAudit(pageId, new Date('2026-01-02T10:00:00Z'));
    await complete(first, {score: 90});
    await db
      .updateTable('alert_events')
      .set({created_at: new Date(Date.now() - 24 * 60 * 60_000)})
      .where('page_id', '=', pageId)
      .execute();
    const second = await claimedAudit(pageId, new Date('2026-01-03T10:00:00Z'));

    await complete(second, {score: 80});

    expect(await alertsFor(pageId)).toHaveLength(2);
  });
});
