import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {NOW_TICK_MS, useNow} from './use-now';

describe('useNow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts at the current time', () => {
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));
    const {result} = renderHook(() => useNow());

    expect(result.current).toBe(Date.parse('2026-08-28T12:00:00.000Z'));
  });

  it('holds one value across renders that no tick separates', () => {
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));
    const {result, rerender} = renderHook(() => useNow());
    const first = result.current;

    vi.setSystemTime(new Date('2026-08-28T12:00:05.000Z'));
    rerender();

    expect(result.current).toBe(first);
  });

  it('moves on once a tick has passed', () => {
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));
    const {result} = renderHook(() => useNow());

    act(() => {
      vi.advanceTimersByTime(NOW_TICK_MS);
    });

    expect(result.current).toBe(Date.parse('2026-08-28T12:00:00.000Z') + NOW_TICK_MS);
  });

  it('honours a tick of its own', () => {
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));
    const {result} = renderHook(() => useNow(1_000));

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current).toBe(Date.parse('2026-08-28T12:00:00.000Z') + 1_000);
  });

  it('stops ticking once unmounted', () => {
    const {unmount} = renderHook(() => useNow());

    expect(vi.getTimerCount()).toBe(1);
    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
