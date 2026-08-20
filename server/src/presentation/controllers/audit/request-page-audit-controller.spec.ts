import {describe, expect, it, vi} from 'vitest';
import {RequestPageAuditController} from './request-page-audit-controller.js';
import type {RequestPageAudit, RequestPageAuditResult} from '../../../domain/usecases/request-page-audit.js';
import {mockAuditModel} from '../../../data/test/index.js';

const makeSut = (result: RequestPageAuditResult) => {
  const requestPageAudit: RequestPageAudit = {
    request: vi.fn<RequestPageAudit['request']>(() => Promise.resolve(result)),
  };
  return {sut: new RequestPageAuditController(requestPageAudit), requestPageAudit};
};

describe('RequestPageAuditController', () => {
  it('accepts with the public uuid, which is what the client polls', async () => {
    const audit = {...mockAuditModel(), publicUuid: '11111111-1111-1111-1111-111111111111'};
    const {sut} = makeSut({outcome: 'queued', audit});

    const response = await sut.handle({id: '42', userId: '7'});

    expect(response.statusCode).toBe(202);
    expect(response.body).toMatchObject({auditId: '11111111-1111-1111-1111-111111111111'});
  });

  it('never puts the internal id on the wire', async () => {
    const audit = {...mockAuditModel(), id: '99', publicUuid: '11111111-1111-1111-1111-111111111111'};
    const {sut} = makeSut({outcome: 'queued', audit});

    const response = await sut.handle({id: '42', userId: '7'});

    expect(JSON.stringify(response.body)).not.toContain('"99"');
  });

  it('answers 404 for a page the account does not own', async () => {
    const {sut} = makeSut({outcome: 'not-found'});

    expect((await sut.handle({id: '42', userId: '7'})).statusCode).toBe(404);
  });

  it('does not reach the usecase without an id in the path', async () => {
    const {sut, requestPageAudit} = makeSut({outcome: 'not-found'});

    expect((await sut.handle({userId: '7'})).statusCode).toBe(404);
    expect(requestPageAudit.request).not.toHaveBeenCalled();
  });

  it('gives the in-flight refusal its own code, so the client can branch', async () => {
    const {sut} = makeSut({outcome: 'in-flight'});

    const response = await sut.handle({id: '42', userId: '7'});

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({code: 'audit_in_flight'});
  });

  it('sends when the allowance refills, because a sentence without it reads as a bug', async () => {
    const {sut} = makeSut({outcome: 'allowance-spent', resetAt: new Date('2026-08-19T00:00:00.000Z')});

    const response = await sut.handle({id: '42', userId: '7'});

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      code: 'on_demand_audit_spent',
      resetAt: '2026-08-19T00:00:00.000Z',
    });
  });

  it('answers 503 when the queue would not take it', async () => {
    const {sut} = makeSut({outcome: 'unavailable'});

    expect((await sut.handle({id: '42', userId: '7'})).statusCode).toBe(503);
  });

  it('turns an unexpected failure into a 500 rather than leaking it', async () => {
    const requestPageAudit: RequestPageAudit = {
      request: vi.fn<RequestPageAudit['request']>(() => Promise.reject(new Error('boom'))),
    };
    const sut = new RequestPageAuditController(requestPageAudit);

    const response = await sut.handle({id: '42', userId: '7'});

    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('boom');
  });
});
