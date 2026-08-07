import {describe, expect, it, vi} from 'vitest';
import {DbLoadAuditResult} from './db-load-audit-result.js';
import {mockAuditModel} from '../../test/index.js';
import type {LoadAuditByPublicUuidRepository} from '../../protocols/db/audit/load-audit-by-public-uuid-repository.js';
import type {LoadViolationsByAuditIdRepository} from '../../protocols/db/violation/load-violations-by-audit-id-repository.js';

const makeSut = () => {
  const audits = {
    loadByPublicUuid: vi.fn<LoadAuditByPublicUuidRepository['loadByPublicUuid']>(async () => mockAuditModel()),
  };
  const violations = {
    loadByAuditId: vi.fn<LoadViolationsByAuditIdRepository['loadByAuditId']>(async () => []),
  };
  return {sut: new DbLoadAuditResult(audits, violations), audits, violations};
};

describe('DbLoadAuditResult', () => {
  it('returns the audit with its violations once it is done', async () => {
    const {sut, audits, violations} = makeSut();
    audits.loadByPublicUuid.mockResolvedValueOnce({...mockAuditModel(), status: 'done'});
    violations.loadByAuditId.mockResolvedValueOnce([
      {
        id: 'v1',
        auditId: 'audit-1',
        ruleId: 'label',
        impact: 'critical',
        description: 'd',
        helpUrl: 'u',
        nodes: [],
      },
    ]);

    const result = await sut.load('11111111-1111-1111-1111-111111111111');

    expect(result?.audit).toEqual({...mockAuditModel(), status: 'done'});
    expect(result?.violations).toHaveLength(1);
    expect(violations.loadByAuditId).toHaveBeenCalledWith('audit-1');
  });

  it('reports no violations until the audit has finished', async () => {
    // A running audit's violations are whatever the current attempt has
    // written so far, and a retry replaces them wholesale - publishing them
    // would show a partial set as the answer. A failed audit's leftovers
    // describe a run that did not complete.
    for (const status of ['queued', 'running', 'failed'] as const) {
      const {sut, audits, violations} = makeSut();
      audits.loadByPublicUuid.mockResolvedValueOnce({...mockAuditModel(), status});

      const result = await sut.load('11111111-1111-1111-1111-111111111111');

      expect(result?.violations).toEqual([]);
      expect(violations.loadByAuditId).not.toHaveBeenCalled();
    }
  });

  it('returns null for a uuid no audit carries', async () => {
    const {sut, audits} = makeSut();
    audits.loadByPublicUuid.mockResolvedValueOnce(null);

    expect(await sut.load('11111111-1111-1111-1111-111111111111')).toBeNull();
  });

  it('does not query violations when there is no audit', async () => {
    // A mistyped share link is the common case, and it should cost one query.
    const {sut, audits, violations} = makeSut();
    audits.loadByPublicUuid.mockResolvedValueOnce(null);

    await sut.load('nope');

    expect(violations.loadByAuditId).not.toHaveBeenCalled();
  });
});
