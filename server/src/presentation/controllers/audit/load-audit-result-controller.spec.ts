import {describe, expect, it, vi} from 'vitest';
import {LoadAuditResultController} from './load-audit-result-controller.js';
import {mockAuditModel} from '../../../data/test/index.js';
import type {LoadAuditResult} from '../../../domain/usecases/load-audit-result.js';

const makeSut = () => {
  const loadAuditResult = {
    load: vi.fn<LoadAuditResult['load']>(async () => ({
      audit: mockAuditModel(),
      violations: [],
    })),
  };
  return {sut: new LoadAuditResultController(loadAuditResult), loadAuditResult};
};

describe('LoadAuditResultController', () => {
  it('returns the public view of an audit', async () => {
    const {sut} = makeSut();

    const response = await sut.handle({uuid: '11111111-1111-1111-1111-111111111111'});

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      auditId: '11111111-1111-1111-1111-111111111111',
      url: 'https://example.test/a',
      status: 'queued',
    });
  });

  it('answers 404 for an unknown id', async () => {
    const {sut, loadAuditResult} = makeSut();
    loadAuditResult.load.mockResolvedValueOnce(null);

    expect((await sut.handle({uuid: 'nope'})).statusCode).toBe(404);
  });

  it('answers 404 for a malformed id, not 500', async () => {
    // A malformed uuid cannot match a row, so it is a miss rather than an
    // error - the repository already refuses to let SQLSTATE 22P02 escape.
    const {sut, loadAuditResult} = makeSut();
    loadAuditResult.load.mockResolvedValueOnce(null);

    expect((await sut.handle({uuid: 'not-a-uuid'})).statusCode).toBe(404);
  });

  it('answers 404 when no id was supplied at all', async () => {
    const {sut, loadAuditResult} = makeSut();

    expect((await sut.handle({uuid: undefined})).statusCode).toBe(404);
    expect(loadAuditResult.load).not.toHaveBeenCalled();
  });

  it('lets a finished audit be cached, and an in-flight one not', async () => {
    const {sut, loadAuditResult} = makeSut();
    const cases = [
      ['done', 'public, max-age=3600'],
      ['failed', 'public, max-age=3600'],
      ['queued', 'no-store'],
      ['running', 'no-store'],
    ] as const;

    for (const [status, expected] of cases) {
      loadAuditResult.load.mockResolvedValueOnce({
        audit: {...mockAuditModel(), status},
        violations: [],
      });

      const response = await sut.handle({uuid: '11111111-1111-1111-1111-111111111111'});

      expect(response.headers?.['cache-control']).toBe(expected);
    }
  });

  it('answers 500 when the usecase throws', async () => {
    const {sut, loadAuditResult} = makeSut();
    loadAuditResult.load.mockRejectedValueOnce(new Error('database down'));

    expect((await sut.handle({uuid: 'x'})).statusCode).toBe(500);
  });
});
