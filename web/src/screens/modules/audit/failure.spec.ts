import type {AuditResultResponse} from '@tabstop/contract';
import {describe, expect, it} from 'vitest';
import {
  describeAuditFailure,
  describeFailure,
  describePollFailure,
  describeRequestFailure,
  isRateLimited,
} from './failure';
import {ApiError} from '@/api/client';

const audit = (over: Partial<AuditResultResponse> = {}): AuditResultResponse => ({
  auditId: 'abc',
  url: 'https://example.com/',
  status: 'done',
  createdAt: '2026-08-03T09:00:00.000Z',
  completedAt: null,
  score: null,
  countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
  axeVersion: null,
  settled: true,
  error: null,
  violations: [],
  ...over,
});

describe('describeRequestFailure', () => {
  it('turns a 429 into a signup offer rather than an error', () => {
    const error = new ApiError(429, 'Too many requests', {
      error: 'Too many requests',
      retryAfter: 45,
      resetAt: '2026-08-03T10:00:00.000Z',
    });

    const failure = describeRequestFailure(error);

    expect(failure.action).toBe('signup');
    expect(isRateLimited(failure)).toBe(true);
  });

  it('carries the reset time, so the offer can show a countdown', () => {
    const resetAt = '2026-08-03T10:00:00.000Z';
    const error = new ApiError(429, 'Too many requests', {
      error: 'Too many requests',
      retryAfter: 45,
      resetAt,
    });

    expect(describeRequestFailure(error).rateLimit).toEqual({
      error: 'Too many requests',
      retryAfter: 45,
      resetAt,
    });
  });

  it('does not claim a signup offer when the 429 body was unusable', () => {
    const error = new ApiError(429, 'Too many requests', {error: 'Too many requests'});

    const failure = describeRequestFailure(error);

    expect(failure.action).not.toBe('signup');
    expect(isRateLimited(failure)).toBe(false);
  });

  it('sends a 400 back to the URL, since retrying it cannot help', () => {
    const error = new ApiError(400, "That address can't be audited", {});

    expect(describeRequestFailure(error)).toEqual({
      message: "That address can't be audited",
      action: 'check-url',
      source: 'request',
    });
  });

  it('quotes the server rather than writing its own sentence', () => {
    const error = new ApiError(400, 'Remove the username and password from that URL', {});

    expect(describeRequestFailure(error).message).toBe('Remove the username and password from that URL');
  });

  it('offers a retry on a 503, which is the queue asking for one', () => {
    const error = new ApiError(503, 'Could not queue that audit, please try again', {});

    expect(describeRequestFailure(error).action).toBe('retry');
  });

  it('offers a retry on a 500', () => {
    expect(describeRequestFailure(new ApiError(500, 'Internal server error', null)).action).toBe('retry');
  });

  it('offers a retry when the request never reached the server', () => {
    const failure = describeRequestFailure(new TypeError('Failed to fetch'));

    expect(failure.action).toBe('retry');
    expect(failure.message).toMatch(/Could not reach tabstop/);
    expect(failure.message).not.toBe('Something went wrong');
  });

  it('offers nothing for a 4xx it has no answer for', () => {
    expect(describeRequestFailure(new ApiError(403, 'Forbidden', null)).action).toBe('none');
  });

  it('branches on status, not on message text', () => {
    const first = describeRequestFailure(new ApiError(400, "That address can't be audited", {}));
    const reworded = describeRequestFailure(new ApiError(400, 'We cannot audit that address', {}));

    expect(reworded.action).toBe(first.action);
    expect(reworded.message).toBe('We cannot audit that address');
  });
});

describe('describeAuditFailure', () => {
  it('quotes the failure the server recorded', () => {
    expect(describeAuditFailure(audit({status: 'failed', error: 'Could not resolve that domain'}))).toEqual({
      message: 'Could not resolve that domain',
      action: 'retry',
      source: 'audit',
    });
  });

  it('still says something when a failed audit recorded no reason', () => {
    expect(describeAuditFailure(audit({status: 'failed', error: null})).message).toBe('Something went wrong');
  });

  it('offers a retry even on a permanently blocked address, deliberately', () => {
    expect(describeAuditFailure(audit({status: 'failed', error: "That address can't be audited"}))).toEqual({
      message: "That address can't be audited",
      action: 'retry',
      source: 'audit',
    });
  });
});

describe('describeFailure', () => {
  it('is null while nothing has gone wrong', () => {
    const none = {requestError: null, pollError: null};
    expect(describeFailure({...none, audit: audit({status: 'running'})})).toBeNull();
    expect(describeFailure({...none, audit: undefined})).toBeNull();
    expect(describeFailure({...none, audit: audit({status: 'done'})})).toBeNull();
  });

  it('reports a refused request', () => {
    expect(
      describeFailure({
        requestError: new ApiError(400, 'nope', {}),
        pollError: null,
        audit: undefined,
      })?.action,
    ).toBe('check-url');
  });

  it('reports an audit that ended in failed', () => {
    expect(
      describeFailure({
        requestError: null,
        pollError: null,
        audit: audit({status: 'failed', error: 'boom'}),
      })?.message,
    ).toBe('boom');
  });

  it('prefers the request failure when somehow both are present', () => {
    const failure = describeFailure({
      requestError: new ApiError(429, 'Too many requests', {
        error: 'Too many requests',
        retryAfter: 30,
        resetAt: '2026-08-03T10:00:00.000Z',
      }),
      pollError: null,
      audit: audit({status: 'failed', error: 'Could not resolve that domain'}),
    });

    expect(failure?.action).toBe('signup');
  });

  it('reports a failed POLL, which had no way to be reported at all', () => {
    const failure = describeFailure({
      requestError: null,
      pollError: new ApiError(500, 'Internal server error', null),
      audit: undefined,
    });

    expect(failure).toEqual({
      message: 'Internal server error',
      action: 'retry',
      source: 'poll',
    });
  });
});

describe('describePollFailure', () => {
  it('offers a retry that means "ask again", not "audit again"', () => {
    expect(describePollFailure(new ApiError(503, 'Service Unavailable', null))).toEqual({
      message: 'Service Unavailable',
      action: 'retry',
      source: 'poll',
    });
  });

  it('does not offer a signup for a 429 on the READ', () => {
    const failure = describePollFailure(
      new ApiError(429, 'Too many requests', {
        error: 'Too many requests',
        retryAfter: 2,
        resetAt: '2026-08-03T10:00:00.000Z',
      }),
    );

    expect(failure.action).toBe('retry');
    expect(failure.rateLimit).toBeUndefined();
  });

  it('offers nothing for a 404, the one permanent poll failure', () => {
    expect(describePollFailure(new ApiError(404, 'Audit not found', null)).action).toBe('none');
  });

  it('offers a retry when the poll never reached the server', () => {
    const failure = describePollFailure(new TypeError('Failed to fetch'));

    expect(failure.action).toBe('retry');
    expect(failure.message).toMatch(/Lost contact with tabstop/);
    expect(failure.message).not.toBe(describeRequestFailure(new TypeError('x')).message);
  });
});
