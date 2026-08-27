import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Kysely} from 'kysely';
import {makeDatabase} from '../helpers/postgres-helper.js';
import {PostgresViolationRepository} from './postgres-violation-repository.js';
import type {AddViolationParams} from '../../../../data/protocols/db/violation/violation-params.js';
import type {Database} from '../database.js';

describe('PostgresViolationRepository', () => {
  let db: Kysely<Database>;
  let sut: PostgresViolationRepository;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) {
      throw new Error('DATABASE_URL not set by globalSetup');
    }
    db = makeDatabase(url);
    sut = new PostgresViolationRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const CLAIM = new Date('2026-07-27T10:00:00Z');

  const makeAudit = async (): Promise<string> => {
    const audit = await db
      .insertInto('audits')
      .values({
        page_id: null,
        url: `https://${randomUUID()}.test/x`,
        status: 'running',
        claimed_at: CLAIM,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return audit.id;
  };

  const contrast: AddViolationParams = {
    ruleId: 'color-contrast',
    impact: 'serious',
    description: 'Elements must have sufficient colour contrast',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
    nodes: [{target: ['#main > p'], html: '<p>hi</p>'}],
  };

  it('stores and returns a violation', async () => {
    const auditId = await makeAudit();

    await sut.replaceAll(auditId, CLAIM, [contrast]);
    const loaded = await sut.loadByAuditId(auditId);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      auditId,
      ruleId: 'color-contrast',
      impact: 'serious',
      description: 'Elements must have sufficient colour contrast',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
    });
  });

  it('round-trips the jsonb nodes intact', async () => {
    const auditId = await makeAudit();

    await sut.replaceAll(auditId, CLAIM, [contrast]);
    const loaded = await sut.loadByAuditId(auditId);

    expect(loaded[0]?.nodes).toEqual([{target: ['#main > p'], html: '<p>hi</p>'}]);
  });

  it('stores several violations at once', async () => {
    const auditId = await makeAudit();

    await sut.replaceAll(auditId, CLAIM, [
      contrast,
      {
        ruleId: 'image-alt',
        impact: 'critical',
        description: 'Images must have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
        nodes: [{target: ['img'], html: '<img>'}],
      },
    ]);

    const loaded = await sut.loadByAuditId(auditId);
    expect(loaded.map((violation) => violation.ruleId)).toEqual(['color-contrast', 'image-alt']);
  });

  it('accepts an empty list, because a clean page is the success case', async () => {
    const auditId = await makeAudit();

    await expect(sut.replaceAll(auditId, CLAIM, [])).resolves.toBeUndefined();
    expect(await sut.loadByAuditId(auditId)).toEqual([]);
  });

  it('returns an empty array for an audit with no violations', async () => {
    const auditId = await makeAudit();

    expect(await sut.loadByAuditId(auditId)).toEqual([]);
  });

  it("replaces an audit's violations instead of appending to them", async () => {
    const auditId = await makeAudit();
    const violation = {
      ruleId: 'image-alt',
      impact: 'critical' as const,
      description: 'Images must have alternate text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
      nodes: [{target: ['img'], html: '<img>'}],
    };

    await sut.replaceAll(auditId, CLAIM, [violation]);
    await sut.replaceAll(auditId, CLAIM, [violation]);

    expect(await sut.loadByAuditId(auditId)).toHaveLength(1);
  });

  it("clears an audit's violations when the page comes back clean", async () => {
    const auditId = await makeAudit();
    await sut.replaceAll(auditId, CLAIM, [
      {
        ruleId: 'label',
        impact: 'critical' as const,
        description: 'Form elements must have labels',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/label',
        nodes: [{target: ['input'], html: '<input>'}],
      },
    ]);

    await sut.replaceAll(auditId, CLAIM, []);

    expect(await sut.loadByAuditId(auditId)).toEqual([]);
  });

  it('serialises concurrent replacements instead of duplicating them', async () => {
    const auditId = await makeAudit();
    const violation = {
      ruleId: 'image-alt',
      impact: 'critical' as const,
      description: 'Images must have alternate text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
      nodes: [{target: ['img'], html: '<img>'}],
    };

    await Promise.all([
      sut.replaceAll(auditId, CLAIM, [violation]),
      sut.replaceAll(auditId, CLAIM, [violation]),
      sut.replaceAll(auditId, CLAIM, [violation]),
    ]);

    expect(await sut.loadByAuditId(auditId)).toHaveLength(1);
  });

  it('stores a violation axe gave no severity, rather than discarding it', async () => {
    const auditId = await makeAudit();

    await sut.replaceAll(auditId, CLAIM, [
      {
        ruleId: 'some-rule-without-impact',
        impact: null,
        description: 'A rule whose checks carry no severity',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/x',
        nodes: [{target: ['div'], html: '<div>'}],
      },
    ]);

    const stored = await sut.loadByAuditId(auditId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.impact).toBeNull();
  });

  it('ignores a write from an attempt that no longer owns the audit', async () => {
    const auditId = await makeAudit();
    await sut.replaceAll(auditId, CLAIM, [contrast]);

    const supersededClaim = new Date('2026-07-27T09:00:00Z');
    await sut.replaceAll(auditId, supersededClaim, []);

    expect(await sut.loadByAuditId(auditId)).toHaveLength(1);
  });

  it('ignores a write once the audit is no longer running', async () => {
    const auditId = await makeAudit();
    await sut.replaceAll(auditId, CLAIM, [contrast]);
    await db.updateTable('audits').set({status: 'done'}).where('id', '=', auditId).execute();

    await sut.replaceAll(auditId, CLAIM, []);

    expect(await sut.loadByAuditId(auditId)).toHaveLength(1);
  });
});
