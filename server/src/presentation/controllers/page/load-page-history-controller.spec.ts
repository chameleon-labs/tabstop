import {describe, expect, it} from 'vitest';
import {LoadPageHistoryController, type LoadPageHistoryQuery} from './load-page-history-controller.js';
import {mockLoadPageHistory, mockValidation} from '../../test/index.js';

const makeSut = (days = 90) => {
  const validation = mockValidation<LoadPageHistoryQuery>({days});
  const loadPageHistory = mockLoadPageHistory();
  return {
    sut: new LoadPageHistoryController(validation, loadPageHistory),
    validation,
    loadPageHistory,
  };
};

describe('LoadPageHistoryController', () => {
  it('returns every audit in the window as a point, oldest first', async () => {
    const {sut, loadPageHistory} = makeSut();

    const response = await sut.handle({id: 'any-page-id', userId: 'user-1'});

    expect(loadPageHistory.load).toHaveBeenCalledWith({
      pageId: 'any-page-id',
      userId: 'user-1',
      days: 90,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      pageId: 'any-page-id',
      url: 'https://example.test/pricing',
      days: 90,
      points: [
        {
          auditId: '33333333-3333-3333-3333-333333333333',
          createdAt: '2026-07-27T09:00:00.000Z',
          status: 'done',
          score: 86,
          countsByImpact: {minor: 1, moderate: 2, serious: 0, critical: 1},
          axeVersion: '4.12.1',
        },
        {
          auditId: '44444444-4444-4444-4444-444444444444',
          createdAt: '2026-07-28T09:00:00.000Z',
          status: 'failed',
          score: null,
          countsByImpact: {minor: 1, moderate: 2, serious: 0, critical: 1},
          axeVersion: null,
        },
        {
          auditId: '22222222-2222-2222-2222-222222222222',
          createdAt: '2026-07-29T09:00:00.000Z',
          status: 'done',
          score: 74,
          countsByImpact: {minor: 1, moderate: 2, serious: 0, critical: 1},
          axeVersion: '4.12.1',
        },
      ],
    });
  });

  it('carries axeVersion per point so the chart can mark an engine change', async () => {
    const {sut} = makeSut();

    const response = await sut.handle({id: 'any-page-id', userId: 'user-1'});
    const {points} = response.body as {points: Record<string, unknown>[]};

    expect(points.map((point) => point.axeVersion)).toEqual(['4.12.1', null, '4.12.1']);
  });

  it('never exposes an internal audit id', async () => {
    const {sut} = makeSut();

    const response = await sut.handle({id: 'any-page-id', userId: 'user-1'});
    const {points} = response.body as {points: Record<string, unknown>[]};

    for (const point of points) {
      expect(point.auditId).not.toBe('any-audit-id');
    }
  });

  it('echoes back the window the server actually used', async () => {
    const {sut} = makeSut(365);

    expect((await sut.handle({id: 'any-page-id', userId: 'user-1'})).body).toMatchObject({days: 365});
  });

  it('lets a browser cache it privately, keyed on the session', async () => {
    const {sut} = makeSut();

    const response = await sut.handle({id: 'any-page-id', userId: 'user-1'});

    expect(response.headers).toEqual({'cache-control': 'private, max-age=60', vary: 'Cookie'});
  });

  it('returns 404 for a page this account does not own', async () => {
    const {sut, loadPageHistory} = makeSut();
    loadPageHistory.load.mockResolvedValueOnce(null);

    const response = await sut.handle({id: 'someone-elses-page', userId: 'user-1'});

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({error: 'No page found for that id'});
    expect(response.headers).toBeUndefined();
  });

  it('returns 404 when no id reached the controller', async () => {
    const {sut, loadPageHistory} = makeSut();

    expect((await sut.handle({userId: 'user-1'})).statusCode).toBe(404);
    expect(loadPageHistory.load).not.toHaveBeenCalled();
  });

  it('returns 400 when validation rejects the window', async () => {
    const {sut, validation, loadPageHistory} = makeSut();
    validation.validate.mockReturnValueOnce({
      error: new Error('days: Expected int, received NaN'),
    });

    const response = await sut.handle({id: 'any-page-id', userId: 'user-1'});

    expect(response.statusCode).toBe(400);
    expect(loadPageHistory.load).not.toHaveBeenCalled();
  });

  it('returns 500 without leaking the failure when the usecase throws', async () => {
    const {sut, loadPageHistory} = makeSut();
    loadPageHistory.load.mockRejectedValueOnce(new Error('connection terminated unexpectedly'));

    const response = await sut.handle({id: 'any-page-id', userId: 'user-1'});

    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('connection terminated');
  });
});
