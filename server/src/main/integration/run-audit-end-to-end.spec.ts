import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {UrlPolicy} from '../../domain/services/url-safety.js';
import {DEFAULT_URL_POLICY, isBlockedAddress} from '../../infra/net/ip-address-policy.js';
import {NodeDnsResolver} from '../../infra/net/node-dns-resolver.js';
import type {Kysely} from 'kysely';
import {DbRunAudit} from '../../data/usecases/run-audit/db-run-audit.js';
import {PermanentAuditError} from '../../domain/errors/permanent-audit-error.js';
import {summariseViolations} from '../../domain/services/score.js';
import {PlaywrightAxeAuditor} from '../../infra/audit/playwright-axe-auditor.js';
import {startFixtureServer, type FixtureServer} from '../../infra/audit/test/fixture-server.js';
import {makeDatabase} from '../../infra/db/postgres/helpers/postgres-helper.js';
import type {Database} from '../../infra/db/postgres/database.js';
import {PostgresAuditRepository} from '../../infra/db/postgres/audit/postgres-audit-repository.js';
import {PostgresViolationRepository} from '../../infra/db/postgres/violation/postgres-violation-repository.js';

const allowingFixtureServer: UrlPolicy = {
  isAllowedPort: () => true,
  isBlockedAddress: (address) => (address === '127.0.0.1' || address === '::1' ? false : isBlockedAddress(address)),
  isIpLiteral: DEFAULT_URL_POLICY.isIpLiteral,
};

describe('run-audit end to end', () => {
  let db: Kysely<Database>;
  let server: FixtureServer;
  let auditor: PlaywrightAxeAuditor;
  let sut: DbRunAudit;
  let violations: PostgresViolationRepository;
  let audits: PostgresAuditRepository;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) {
      throw new Error('DATABASE_URL not set by globalSetup');
    }
    db = makeDatabase(url);
    server = await startFixtureServer();
    auditor = new PlaywrightAxeAuditor(
      {navigationMs: 20_000, settleMs: 3_000, fallbackSettleMs: 500},
      new NodeDnsResolver(),
      allowingFixtureServer,
    );
    audits = new PostgresAuditRepository(db);
    violations = new PostgresViolationRepository(db);
    sut = new DbRunAudit(audits, audits, violations, auditor);
  }, 60_000);

  afterAll(async () => {
    await auditor.close();
    await server.close();
    await db.destroy();
  });

  const queueAudit = async (url: string): Promise<string> => {
    const row = await db
      .insertInto('audits')
      .values({page_id: null, url, status: 'queued'})
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  };

  const load = async (id: string) =>
    await db.selectFrom('audits').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  const params = (auditId: string, isFinalAttempt = false) => ({
    auditId,
    signal: new AbortController().signal,
    isFinalAttempt,
  });

  it('takes a queued audit to done, with violations and counts stored', async () => {
    const auditId = await queueAudit(server.baseUrl);

    await sut.run(params(auditId));

    const audit = await load(auditId);
    expect(audit.status).toBe('done');
    expect(audit.settled).toBe(true);
    expect(audit.axe_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(audit.duration_ms).toBeGreaterThan(0);
    expect(audit.completed_at).toBeInstanceOf(Date);

    const stored = await db.selectFrom('violations').selectAll().where('audit_id', '=', auditId).execute();
    const ruleIds = stored.map((violation) => violation.rule_id);
    expect(ruleIds).toContain('image-alt');
    expect(ruleIds).toContain('label');

    const expected = summariseViolations(
      stored.map((violation) => ({
        ruleId: violation.rule_id,
        impact: violation.impact,
        nodeCount: violation.nodes.length,
      })),
    );
    expect(audit.score).toBe(expected.score);
    expect(audit.score).toBeLessThan(100);

    const counts = audit.counts_by_impact;
    expect(Object.keys(counts).toSorted()).toEqual(['critical', 'minor', 'moderate', 'serious']);
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const nodeTotal = stored.reduce((sum, violation) => sum + violation.nodes.length, 0);
    expect(total).toBe(nodeTotal);

    expect(stored[0]?.nodes[0]).toEqual({
      target: expect.any(Array),
      html: expect.any(String),
    });
  }, 60_000);

  it('replaces the violations a crashed attempt left behind, rather than appending', async () => {
    const auditId = await queueAudit(server.baseUrl);

    const firstClaim = await audits.claimForRun(auditId);
    if (firstClaim === null) {
      throw new Error('fixture failed to claim');
    }
    await violations.replaceAll(auditId, firstClaim, [
      {
        ruleId: 'left-behind-by-the-crashed-attempt',
        impact: 'serious',
        description: 'Committed before the worker died',
        helpUrl: 'https://example.test/stale',
        nodes: [{target: ['#stale'], html: '<div id="stale">'}],
      },
    ]);
    await audits.releaseClaim(auditId, firstClaim);

    await sut.run(params(auditId));

    const stored = await violations.loadByAuditId(auditId);
    const ruleIds = stored.map((violation) => violation.ruleId);

    expect(ruleIds).not.toContain('left-behind-by-the-crashed-attempt');
    expect(ruleIds).toContain('image-alt');
    expect(new Set(ruleIds).size).toBe(ruleIds.length);

    const audit = await load(auditId);
    expect(audit.status).toBe('done');
    const counted = Object.values(audit.counts_by_impact).reduce((sum, n) => sum + n, 0);
    const nodeTotal = stored.reduce((sum, violation) => sum + violation.nodes.length, 0);
    expect(counted).toBe(nodeTotal);
  }, 60_000);

  it('leaves a finished audit untouched when the queue redelivers it', async () => {
    const auditId = await queueAudit(server.baseUrl);
    await sut.run(params(auditId));
    const finished = await load(auditId);

    await sut.run(params(auditId));

    const after = await load(auditId);
    expect(after.completed_at).toEqual(finished.completed_at);
    expect(after.duration_ms).toBe(finished.duration_ms);
  }, 60_000);

  it('completes a page that never settles, flagged rather than failed', async () => {
    const auditId = await queueAudit(`${server.baseUrl}/never-idle`);

    await sut.run(params(auditId));

    const audit = await load(auditId);
    expect(audit.status).toBe('done');
    expect(audit.settled).toBe(false);
  }, 60_000);

  it('fails a dead address permanently, with a message a user can act on', async () => {
    const auditId = await queueAudit('http://127.0.0.1:45999/');

    await expect(sut.run(params(auditId))).rejects.toThrow(PermanentAuditError);

    const audit = await load(auditId);
    expect(audit.status).toBe('failed');
    expect(audit.error).toBe('Nothing responded at that address');
    expect(audit.completed_at).toBeInstanceOf(Date);
  }, 60_000);

  it('hands the audit back after a retryable failure, and the retry completes it', async () => {
    const auditId = await queueAudit(server.baseUrl);
    const aborted = new AbortController();
    aborted.abort();

    await expect(sut.run({auditId, signal: aborted.signal, isFinalAttempt: false})).rejects.toThrow(Error);

    const betweenAttempts = await load(auditId);
    expect(betweenAttempts.status).toBe('queued');
    expect(betweenAttempts.claimed_at).toBeNull();

    await sut.run(params(auditId));

    const finished = await load(auditId);
    expect(finished.status).toBe('done');
    expect(finished.completed_at).toBeInstanceOf(Date);
    expect(await db.selectFrom('violations').select('id').where('audit_id', '=', auditId).execute()).not.toHaveLength(
      0,
    );
  }, 60_000);

  it('records a blocked address as a failed audit with a non-leaking message', async () => {
    const auditId = await queueAudit('http://169.254.169.254/latest/meta-data/');

    await expect(sut.run(params(auditId))).rejects.toThrow(PermanentAuditError);

    const audit = await load(auditId);
    expect(audit.status).toBe('failed');
    expect(audit.error).toBe("That address can't be audited");
    expect(audit.error).not.toMatch(/refused|timed out|resolve|blocked|private|internal|169\.254/i);
  }, 60_000);

  it('keeps a permanently failed audit terminal rather than releasing it', async () => {
    const auditId = await queueAudit('http://127.0.0.1:45999/');

    await expect(sut.run(params(auditId))).rejects.toThrow(PermanentAuditError);

    const failed = await load(auditId);
    expect(failed.status).toBe('failed');
    expect(await sut.run(params(auditId))).toBeUndefined();
    expect((await load(auditId)).status).toBe('failed');
  }, 60_000);
});
