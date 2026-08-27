import {describe, expect, it} from 'vitest';
import {reauditRunFailure} from './reaudit-job-outcome.js';
import type {ReauditRunSummary} from '../../domain/usecases/run-scheduled-reaudits.js';

const summary = (overrides: Partial<ReauditRunSummary> = {}): ReauditRunSummary => ({
  scheduledFor: '2026-08-01',
  pagesConsidered: 10,
  auditsEnqueued: 10,
  skippedDuplicate: 0,
  failed: 0,
  abandonedReclaimed: 0,
  reclaimFailures: 0,
  truncated: false,
  ...overrides,
});

describe('reauditRunFailure', () => {
  it('reports success for a run that finished its work', () => {
    expect(reauditRunFailure(summary(), false)).toBeNull();
  });

  it('fails a run that could not schedule some pages', () => {
    expect(reauditRunFailure(summary({failed: 3}), false)).toContain('could not schedule 3 page(s)');
  });

  it('fails a run that stopped with pages still due', () => {
    expect(reauditRunFailure(summary({truncated: true, pagesConsidered: 50_000}), false)).toContain(
      'stopped at 50000 pages',
    );
  });

  it('does not fail a run cut short by shutdown', () => {
    expect(reauditRunFailure(summary({truncated: true}), true)).toBeNull();
  });

  it('does not fail on shutdown even when pages failed on the way out', () => {
    expect(reauditRunFailure(summary({failed: 3, truncated: true}), true)).toBeNull();
  });

  it('says which problem it is, so the failed job is worth reading', () => {
    expect(reauditRunFailure(summary({failed: 2, truncated: true}), false)).toContain('could not schedule 2 page(s)');
  });

  it('reports success for a night with nothing to do', () => {
    expect(reauditRunFailure(summary({pagesConsidered: 0, auditsEnqueued: 0}), false)).toBeNull();
  });
});
