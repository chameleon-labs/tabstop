import {describe, expect, it, vi} from 'vitest';
import {RequestAuditController} from './request-audit-controller.js';
import {mockAuditModel} from '../../../data/test/index.js';
import type {RequestAudit} from '../../../domain/usecases/request-audit.js';

const makeSut = () => {
  const requestAudit = {
    request: vi.fn<RequestAudit['request']>(() =>
      Promise.resolve({
        outcome: 'queued' as const,
        audit: mockAuditModel(),
      }),
    ),
  };
  return {sut: new RequestAuditController(requestAudit), requestAudit};
};

describe('RequestAuditController', () => {
  it('accepts a valid url and reports the public id and a poll interval', async () => {
    const {sut} = makeSut();

    const response = await sut.handle({url: 'https://example.com/a'});

    expect(response.statusCode).toBe(202);
    expect(response.body).toEqual({
      auditId: '11111111-1111-1111-1111-111111111111',
      status: 'queued',
      pollAfterMs: 2000,
    });
  });

  it('never exposes the internal id', async () => {
    const {sut} = makeSut();

    const response = await sut.handle({url: 'https://example.com/a'});

    expect(JSON.stringify(response.body)).not.toContain('audit-1');
  });

  it('rejects a missing or non-string url before reaching the usecase', async () => {
    const {sut, requestAudit} = makeSut();

    for (const url of [undefined, '', 42, null, {nested: true}]) {
      const response = await sut.handle({url});
      expect(response.statusCode).toBe(400);
    }
    expect(requestAudit.request).not.toHaveBeenCalled();
  });

  it('turns each rejection into a message a person can act on', async () => {
    const {sut, requestAudit} = makeSut();
    const cases = [
      ['invalid-url', 'That does not look like a URL'],
      ['blocked-scheme', 'Only http and https addresses can be audited'],
      ['blocked-port', 'Only standard web ports can be audited'],
      ['blocked-address', "That address can't be audited"],
    ] as const;

    for (const [reason, message] of cases) {
      requestAudit.request.mockResolvedValueOnce({outcome: 'rejected', reason});

      const response = await sut.handle({url: 'https://example.com/a'});

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({error: message});
    }
  });

  it('answers 503 when the queue is unreachable', async () => {
    const {sut, requestAudit} = makeSut();
    requestAudit.request.mockResolvedValueOnce({outcome: 'unavailable'});

    const response = await sut.handle({url: 'https://example.com/a'});

    expect(response.statusCode).toBe(503);
  });

  it('answers 500 when the usecase throws', async () => {
    const {sut, requestAudit} = makeSut();
    requestAudit.request.mockRejectedValueOnce(new Error('database down'));

    const response = await sut.handle({url: 'https://example.com/a'});

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({error: 'Internal server error'});
  });
});
