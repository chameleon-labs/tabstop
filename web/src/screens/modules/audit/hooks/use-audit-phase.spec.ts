import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useAuditPhase} from './use-audit-phase';
import type {ProgressStatus} from '../phase';

const START = 1_700_000_000_000;

/**
 * Fake timers move `Date.now()` as well as the interval, so advancing the clock
 * advances the hook's own notion of elapsed time. That matters: an injected,
 * FROZEN clock once made an assertion here vacuous - the value could not change
 * under any mutation, so the test passed against the bug it was written for.
 */
describe('useAuditPhase', () => {
  beforeEach(() => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const advance = async (ms: number): Promise<void> => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  const at = (status: ProgressStatus) =>
    renderHook(({s}: {s: ProgressStatus}) => useAuditPhase(s, START, true), {
      initialProps: {s: status},
    });

  it('has nothing to say before anything was submitted', () => {
    const {result} = renderHook(() => useAuditPhase('submitting', null, true));

    expect(result.current).toBeNull();
  });

  it('does not claim a queue place while the request is in flight', () => {
    expect(at('submitting').result.current).toBe('Requesting the audit');
  });

  it('says a queued audit is queued rather than claiming to fetch', () => {
    expect(at('queued').result.current).toBe('Waiting for a free worker');
  });

  it('moves through the phases as time actually passes', async () => {
    const {result} = at('running');
    expect(result.current).toBe('Fetching the page');

    await advance(9_000);
    expect(result.current).toBe('Running the accessibility engine');

    await advance(12_000);
    expect(result.current).toBe('Scoring');
  });

  it('has nothing to say once the audit is over', () => {
    expect(at('done').result.current).toBeNull();
    expect(at('failed').result.current).toBeNull();
  });

  describe('the clock', () => {
    it('stops when the screen is no longer waiting', () => {
      // `since` stays populated after an audit ends - that is what makes it a
      // record of when the work began - so an interval gated on it alone ran
      // for the lifetime of the tab, re-rendering the finished result and its
      // whole violation tree once a second, forever.
      const {rerender, unmount} = renderHook(({a}: {a: boolean}) => useAuditPhase('running', START, a), {
        initialProps: {a: true},
      });
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      rerender({a: false});

      expect(vi.getTimerCount()).toBe(0);
      unmount();
    });

    it('never starts while the screen is not waiting', () => {
      renderHook(() => useAuditPhase('running', START, false));

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('a second audit on the same screen', () => {
    it("does not inherit the first audit's epoch", async () => {
      // This hook lives on the home screen, which outlives any one audit.
      // Guarded on `runningSince === null`, a second audit kept the first one's
      // start time and opened on "Scoring" - counting phases from a job that
      // had already finished, possibly minutes earlier.
      // Starts at `queued` and TRANSITIONS into running, which is what sets
      // the epoch at all. A first audit that begins already in `running` never
      // sets it, so a test written that way passes with the bug present - as
      // the first version of this one did.
      const {result, rerender} = renderHook(({s}: {s: ProgressStatus}) => useAuditPhase(s, START, true), {
        initialProps: {s: 'queued' as ProgressStatus},
      });
      rerender({s: 'running'});
      await advance(25_000);
      expect(result.current).toBe('Scoring');

      // First audit ends, a second is submitted and reaches a worker.
      rerender({s: 'done'});
      rerender({s: 'submitting'});
      rerender({s: 'queued'});
      rerender({s: 'running'});

      expect(result.current).toBe('Fetching the page');
    });
  });

  describe('the queue does not count against the phases', () => {
    it('starts at the first phase however long the queue was', async () => {
      // `startedAt` is when the POST was sent, and the phases describe what a
      // WORKER is doing. A job that waited twenty-five seconds reached its
      // first `running` render already claiming to be "Scoring".
      const {result, rerender} = at('queued');
      await advance(25_000);

      rerender({s: 'running'});

      expect(result.current).toBe('Fetching the page');
    });

    it('runs the phases from when the work started', async () => {
      const {result, rerender} = at('queued');
      await advance(25_000);
      rerender({s: 'running'});

      await advance(9_000);

      expect(result.current).toBe('Running the accessibility engine');
    });
  });
});
