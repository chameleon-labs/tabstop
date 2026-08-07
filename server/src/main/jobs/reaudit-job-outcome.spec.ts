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
    // Truncation used to be logged and nothing else, so a run that did not do
    // the work it promised completed successfully - invisible to every queue
    // dashboard there is. The retry is the useful part rather than a
    // formality: the pages this attempt scheduled now have audits in flight
    // and drop out of the worklist, so the next attempt starts on the tail
    // instead of repeating the head.
    expect(reauditRunFailure(summary({truncated: true, pagesConsidered: 50_000}), false)).toContain(
      'stopped at 50000 pages',
    );
  });

  it('does not fail a run cut short by shutdown', () => {
    // The process is going away, so failing would only spend the job's
    // attempts on retries this worker cannot serve - and the pages it did not
    // reach are simply due tomorrow.
    expect(reauditRunFailure(summary({truncated: true}), true)).toBeNull();
  });

  it('does not fail on shutdown even when pages failed on the way out', () => {
    // Same reasoning, and the case that decides the order of the checks: a
    // shutdown mid-run is likely to leave failures behind it, and treating
    // those as a reason to retry gets the retries thrown away too.
    expect(reauditRunFailure(summary({failed: 3, truncated: true}), true)).toBeNull();
  });

  it('says which problem it is, so the failed job is worth reading', () => {
    // Both conditions at once still reports the schedulable failures first:
    // pages that could not be scheduled is the more actionable of the two, and
    // truncation is usually its consequence.
    expect(reauditRunFailure(summary({failed: 2, truncated: true}), false)).toContain('could not schedule 2 page(s)');
  });

  it('reports success for a night with nothing to do', () => {
    // Zero pages is not a failure. Every account could legitimately have been
    // audited already, and failing here would retry three times a night for a
    // system working exactly as intended.
    expect(reauditRunFailure(summary({pagesConsidered: 0, auditsEnqueued: 0}), false)).toBeNull();
  });
});
