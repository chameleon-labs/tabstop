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

/**
 * The acceptance criterion for #5, with nothing faked below the queue: a real
 * audit row, a real browser, a real page, and a real database. The unit specs
 * cover the branches; this proves the pieces actually fit together.
 */
/**
 * The production policy with exactly two holes, both forced by the fixture
 * server: it listens on loopback and on an ephemeral port. Every other range -
 * 10/8, 169.254/16 and the rest - stays genuinely enforced, so the blocking
 * these specs assert is the real policy at work rather than a stub agreeing
 * with them.
 */
const allowingFixtureServer: UrlPolicy = {
  isAllowedPort: () => true,
  isBlockedAddress: (address) => (address === '127.0.0.1' || address === '::1' ? false : isBlockedAddress(address)),
  // Not relaxed: recognising an address is not part of what these specs need
  // to bend, so it stays the real implementation.
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

    // The score has to come from the violations this run actually stored, not
    // from a constant that happens to match.
    const expected = summariseViolations(
      stored.map((violation) => ({
        ruleId: violation.rule_id,
        impact: violation.impact,
        nodeCount: violation.nodes.length,
      })),
    );
    expect(audit.score).toBe(expected.score);
    // Non-tautological: the fixture page has real violations, so a score of
    // 100 would mean nothing was deducted for them.
    expect(audit.score).toBeLessThan(100);

    // jsonb reorders keys, so compare structurally rather than as JSON text.
    const counts = audit.counts_by_impact;
    expect(Object.keys(counts).toSorted()).toEqual(['critical', 'minor', 'moderate', 'serious']);
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const nodeTotal = stored.reduce((sum, violation) => sum + violation.nodes.length, 0);
    expect(total).toBe(nodeTotal);

    // nodes survive the jsonb round trip as objects, not a Postgres array literal
    expect(stored[0]?.nodes[0]).toEqual({
      target: expect.any(Array),
      html: expect.any(String),
    });
  }, 60_000);

  it('replaces the violations a crashed attempt left behind, rather than appending', async () => {
    // The interruption this reproduces: an attempt commits violations and then
    // dies before writing a terminal status. The retry must REPLACE what it
    // left, not add to it - `violations` has no uniqueness constraint, so an
    // append would double every rule and inflate every count derived from them.
    //
    // Asserting after a completed run instead would prove nothing: the audit
    // would be `done`, and the ownership fence makes any further write a
    // no-op, so the assertion would hold even with replacement broken.
    const auditId = await queueAudit(server.baseUrl);

    // Attempt 1: claims, commits violations, then dies before completion.
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

    // Attempt 2: the queue's retry, running the audit to completion.
    await sut.run(params(auditId));

    const stored = await violations.loadByAuditId(auditId);
    const ruleIds = stored.map((violation) => violation.ruleId);

    // The crashed attempt's row is gone, not sitting alongside the new ones.
    expect(ruleIds).not.toContain('left-behind-by-the-crashed-attempt');
    expect(ruleIds).toContain('image-alt');
    // And nothing is duplicated.
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
    // The regression this pins, end to end and against the real repository: a
    // retryable failure writes no terminal status, so if the claim were kept
    // the row would sit in `running` holding a live lease. The queue's retry
    // arrives seconds later, far inside a ten minute lease, fails to claim,
    // finds nothing to do, reports success - and the audit is stranded in
    // `running` for ever, with no result and no error.
    const auditId = await queueAudit(server.baseUrl);
    const aborted = new AbortController();
    aborted.abort();

    // Attempt 1: fails transiently, with attempts still remaining.
    await expect(sut.run({auditId, signal: aborted.signal, isFinalAttempt: false})).rejects.toThrow(Error);

    const betweenAttempts = await load(auditId);
    expect(betweenAttempts.status).toBe('queued');
    expect(betweenAttempts.claimed_at).toBeNull();

    // Attempt 2: the queue's retry, which must be able to claim and finish.
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
    // The message must not reveal whether anything is listening there. A
    // response that distinguished "blocked" from "unreachable" would turn this
    // endpoint into an internal port scanner.
    expect(audit.error).not.toMatch(/refused|timed out|resolve|blocked|private|internal|169\.254/i);
  }, 60_000);

  it('keeps a permanently failed audit terminal rather than releasing it', async () => {
    const auditId = await queueAudit('http://127.0.0.1:45999/');

    await expect(sut.run(params(auditId))).rejects.toThrow(PermanentAuditError);

    const failed = await load(auditId);
    expect(failed.status).toBe('failed');
    // A released claim here would invite another delivery to re-run a
    // finished audit.
    expect(await sut.run(params(auditId))).toBeUndefined();
    expect((await load(auditId)).status).toBe('failed');
  }, 60_000);
});
