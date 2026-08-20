import {describe, expect, it} from 'vitest';
import {ApiError} from '@/api/client';
import {describeAuditRefusal} from './on-demand-audit';

const NOW = Date.parse('2026-08-18T14:00:00.000Z');

const conflict = (body: Record<string, unknown>, message = 'refused'): ApiError => new ApiError(409, message, body);

describe('describeAuditRefusal', () => {
  it('speaks for a request that never reached the server', () => {
    // A rejected `fetch` carries no sentence to quote. Saying nothing would
    // leave the button re-enabling itself in silence, which reads as a click
    // that did not register.
    expect(describeAuditRefusal(new Error('offline'), NOW)).toEqual({
      message: 'Could not reach tabstop. Check your connection and try again',
      retryable: true,
    });
  });

  it('has nothing to say when there is no failure', () => {
    expect(describeAuditRefusal(null, NOW)).toBeNull();
  });

  it('quotes the server sentence rather than writing a second one', () => {
    // The rule `failure.ts` records: one table of prose, server-side. A copy
    // here drifts the first time either side is reworded.
    const refusal = describeAuditRefusal(
      conflict({code: 'audit_in_flight'}, 'This page is already being audited'),
      NOW,
    );

    expect(refusal?.message).toBe('This page is already being audited');
  });

  it('adds when the allowance comes back, which the server cannot phrase', () => {
    // "Tomorrow" depends on where the reader is, and the server knows only UTC.
    const refusal = describeAuditRefusal(
      conflict(
        {code: 'on_demand_audit_spent', resetAt: '2026-08-19T00:00:00.000Z'},
        'You have used your audit for today',
      ),
      NOW,
      'en-GB',
      'UTC',
    );

    expect(refusal?.message).toBe(
      'You have used your audit for today. The next one is available tomorrow at 00:00 UTC',
    );
    expect(refusal?.retryable).toBe(false);
  });

  it('renders the reset in the reader own timezone, not the server one', () => {
    // 00:00 UTC is 09:00 the same calendar day in Tokyo, so a reader there is
    // told "at", not "tomorrow" - the distinction a UTC-only sentence loses.
    const refusal = describeAuditRefusal(
      conflict({code: 'on_demand_audit_spent', resetAt: '2026-08-19T00:00:00.000Z'}, 'Spent'),
      Date.parse('2026-08-18T20:00:00.000Z'),
      'en-GB',
      'Asia/Tokyo',
    );

    expect(refusal?.message).toContain('at 09:00');
  });

  it('still says something when the allowance body arrives without a reset', () => {
    // A malformed body must degrade to the server's sentence rather than to a
    // sentence containing "Invalid Date".
    const refusal = describeAuditRefusal(conflict({code: 'on_demand_audit_spent'}, 'Spent'), NOW);

    expect(refusal?.message).toBe('Spent');
  });

  it('ignores a code it does not know', () => {
    const refusal = describeAuditRefusal(conflict({code: 'something_new'}, 'Refused'), NOW);

    expect(refusal?.message).toBe('Refused');
    expect(refusal?.retryable).toBe(false);
  });

  it('offers a retry for a server-side failure and not for a refusal', () => {
    expect(describeAuditRefusal(new ApiError(503, 'Try again', {error: 'Try again'}), NOW)?.retryable).toBe(true);
    expect(describeAuditRefusal(conflict({code: 'audit_in_flight'}), NOW)?.retryable).toBe(true);
    expect(
      describeAuditRefusal(conflict({code: 'on_demand_audit_spent', resetAt: '2026-08-19T00:00:00.000Z'}), NOW)
        ?.retryable,
    ).toBe(false);
  });
});
