import {screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {advanceTimers, heldChunk, renderSlowRoute} from '@/test/lazy-route';
import {ROUTE_BUSY_DELAY_MS, useRouteBusy} from './use-route-busy';

const Probe = (): React.JSX.Element => <p data-testid="busy">{String(useRouteBusy())}</p>;

const busy = (): string => screen.getByTestId('busy').textContent ?? '';

describe('useRouteBusy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is quiet on a screen that is not going anywhere', () => {
    renderSlowRoute(<Probe />, heldChunk());

    expect(busy()).toBe('false');
  });

  it('says nothing about a navigation that beats the delay', async () => {
    const chunk = heldChunk();
    const {leave} = renderSlowRoute(<Probe />, chunk);

    await leave();
    await advanceTimers(ROUTE_BUSY_DELAY_MS - 1);

    expect(busy()).toBe('false');

    await chunk.arrive();
    await advanceTimers(ROUTE_BUSY_DELAY_MS);

    expect(busy()).toBe('false');
  });

  it('reports a navigation that outlasts the delay', async () => {
    const chunk = heldChunk();
    const {leave} = renderSlowRoute(<Probe />, chunk);

    await leave();
    await advanceTimers(ROUTE_BUSY_DELAY_MS);

    expect(busy()).toBe('true');
  });

  it('falls quiet again once the screen arrives', async () => {
    const chunk = heldChunk();
    const {leave} = renderSlowRoute(<Probe />, chunk);

    await leave();
    await advanceTimers(ROUTE_BUSY_DELAY_MS);
    expect(busy()).toBe('true');

    await chunk.arrive();
    await advanceTimers(1);

    expect(screen.getByText('the slow screen')).toBeInTheDocument();
    expect(busy()).toBe('false');
  });
});
