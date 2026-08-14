import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {PHASES} from '../phase';
import {
  COMPLETE_HOLD_MS,
  FAST_PHASE_MS,
  PROGRESS_EXIT_MS,
  SCORING_HOLD_MS,
  useAuditPresentation,
  type AuditPresentationOptions,
} from './use-audit-presentation';

const base: AuditPresentationOptions = {
  auditId: 'audit-1',
  status: 'running',
  phase: PHASES[0]?.label ?? null,
  owner: true,
  failure: false,
};

const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('useAuditPresentation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('drains unseen phases before revealing a fast result', async () => {
    const {result, rerender} = renderHook((props: AuditPresentationOptions) => useAuditPresentation(props), {
      initialProps: base,
    });

    rerender({...base, status: 'done', phase: null});
    expect(result.current).toMatchObject({view: 'progress', phase: PHASES[1]?.label, complete: false});

    await advance(FAST_PHASE_MS);
    expect(result.current).toMatchObject({view: 'progress', phase: PHASES[2]?.label, complete: false});

    await advance(SCORING_HOLD_MS);
    expect(result.current).toMatchObject({view: 'progress', phase: null, complete: true});

    await advance(COMPLETE_HOLD_MS);
    expect(result.current.view).toBe('exiting');

    await advance(PROGRESS_EXIT_MS);
    expect(result.current).toMatchObject({view: 'report', completedInSession: true});
  });

  it('shows all three phases when an owner first observes done', async () => {
    const initial: AuditPresentationOptions = {...base, status: undefined, phase: null};
    const {result, rerender} = renderHook((props: AuditPresentationOptions) => useAuditPresentation(props), {
      initialProps: initial,
    });

    rerender({...base, status: 'done', phase: null});
    expect(result.current).toMatchObject({view: 'progress', phase: PHASES[0]?.label, complete: false});

    await advance(FAST_PHASE_MS);
    expect(result.current).toMatchObject({view: 'progress', phase: PHASES[1]?.label, complete: false});

    await advance(FAST_PHASE_MS);
    expect(result.current).toMatchObject({view: 'progress', phase: PHASES[2]?.label, complete: false});

    await advance(SCORING_HOLD_MS);
    expect(result.current).toMatchObject({view: 'progress', phase: null, complete: true});

    await advance(COMPLETE_HOLD_MS);
    expect(result.current.view).toBe('exiting');

    await advance(PROGRESS_EXIT_MS);
    expect(result.current).toMatchObject({view: 'report', completedInSession: true});
  });

  it('moves directly from an observed engine phase to Scoring', () => {
    const {result, rerender} = renderHook((props: AuditPresentationOptions) => useAuditPresentation(props), {
      initialProps: {...base, phase: PHASES[1]?.label ?? null},
    });

    rerender({...base, status: 'done', phase: null});

    expect(result.current).toMatchObject({view: 'progress', phase: PHASES[2]?.label, complete: false});
  });

  it('holds an already visible Scoring phase for 500 ms after done', async () => {
    const {result, rerender} = renderHook((props: AuditPresentationOptions) => useAuditPresentation(props), {
      initialProps: {...base, phase: PHASES[2]?.label ?? null},
    });

    rerender({...base, status: 'done', phase: null});
    await advance(SCORING_HOLD_MS - 1);
    expect(result.current).toMatchObject({view: 'progress', phase: PHASES[2]?.label, complete: false});

    await advance(1);
    expect(result.current).toMatchObject({view: 'progress', phase: null, complete: true});
  });

  it('opens a historical non-owner result without replaying phases', () => {
    const {result} = renderHook(() => useAuditPresentation({...base, status: 'done', phase: null, owner: false}));

    expect(result.current).toMatchObject({view: 'report', completedInSession: false});
    expect(vi.getTimerCount()).toBe(0);
  });

  it('finishes for a non-owner who observed queued or running', () => {
    const {result, rerender} = renderHook((props: AuditPresentationOptions) => useAuditPresentation(props), {
      initialProps: {...base, owner: false, status: 'queued', phase: null},
    });

    rerender({...base, owner: false, status: 'done', phase: null});

    expect(result.current).toMatchObject({
      view: 'progress',
      phase: PHASES[0]?.label,
      complete: false,
      completedInSession: true,
    });
  });

  it('lets failure interrupt and cancel a finish sequence', async () => {
    const {result, rerender} = renderHook((props: AuditPresentationOptions) => useAuditPresentation(props), {
      initialProps: base,
    });

    rerender({...base, status: 'done', phase: null});
    rerender({...base, status: 'done', phase: null, failure: true});
    expect(result.current.view).toBe('failure');

    await advance(FAST_PHASE_MS + SCORING_HOLD_MS + COMPLETE_HOLD_MS + PROGRESS_EXIT_MS);
    expect(result.current.view).toBe('failure');
  });

  it('allows one fresh sequence after retry', () => {
    const {result, rerender} = renderHook((props: AuditPresentationOptions) => useAuditPresentation(props), {
      initialProps: {...base, status: 'failed', phase: null, failure: true},
    });

    rerender({...base, status: 'running', phase: PHASES[0]?.label ?? null, failure: false});
    rerender({...base, status: 'done', phase: null, failure: false});
    const timerCount = vi.getTimerCount();
    rerender({...base, status: 'done', phase: null, failure: false});

    expect(result.current).toMatchObject({view: 'progress', phase: PHASES[1]?.label, complete: false});
    expect(vi.getTimerCount()).toBe(timerCount);
  });

  it('resets latches when the audit id changes', () => {
    const {result, rerender} = renderHook((props: AuditPresentationOptions) => useAuditPresentation(props), {
      initialProps: {...base, status: 'done', phase: null},
    });

    rerender({...base, auditId: 'audit-2', status: undefined, phase: null});

    expect(result.current).toMatchObject({
      view: 'progress',
      phase: null,
      complete: false,
      headline: 'Looking for that audit…',
      completedInSession: false,
    });
  });

  it('does not let an escaped finish callback restart timers for a different audit', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const {rerender} = renderHook((props: AuditPresentationOptions) => useAuditPresentation(props), {
      initialProps: base,
    });

    rerender({...base, status: 'done', phase: null});
    const staleCallback = setTimeoutSpy.mock.calls.at(-1)?.[0];
    expect(typeof staleCallback).toBe('function');

    rerender({...base, auditId: 'audit-2', status: undefined, phase: null});
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      if (typeof staleCallback === 'function') {
        staleCallback();
      }
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer on unmount', () => {
    const {rerender, unmount} = renderHook((props: AuditPresentationOptions) => useAuditPresentation(props), {
      initialProps: base,
    });

    rerender({...base, status: 'done', phase: null});
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
