import {screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {advanceTimers, heldChunk, renderSlowRoute} from '@/test/lazy-route';
import {ROUTE_BUSY_DELAY_MS, useRouteBusy} from '@/screens/hooks/use-route-busy';
import {RouteProgress} from '.';

const Shell = (): React.JSX.Element => <RouteProgress busy={useRouteBusy()} />;

const bar = (): HTMLElement | null => document.querySelector('.route-progress');

describe('RouteProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows nothing on a screen that is not going anywhere', () => {
    renderSlowRoute(<Shell />, heldChunk());

    expect(bar()).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('opens the live region empty, before there is anything to say', async () => {
    const {leave} = renderSlowRoute(<Shell />, heldChunk());

    await leave();

    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(bar()).not.toBeInTheDocument();
  });

  it('names the wait once it outlasts the delay', async () => {
    const {leave} = renderSlowRoute(<Shell />, heldChunk());

    await leave();
    await advanceTimers(ROUTE_BUSY_DELAY_MS);

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(bar()).toBeInTheDocument();
  });

  it('keeps the bar out of the accessibility tree, so the wait is said once', async () => {
    const {leave} = renderSlowRoute(<Shell />, heldChunk());

    await leave();
    await advanceTimers(ROUTE_BUSY_DELAY_MS);

    expect(bar()).toHaveAttribute('aria-hidden', 'true');
  });

  it('leaves nothing behind once the screen arrives', async () => {
    const chunk = heldChunk();
    const {leave} = renderSlowRoute(<Shell />, chunk);

    await leave();
    await advanceTimers(ROUTE_BUSY_DELAY_MS);
    expect(bar()).toBeInTheDocument();

    await chunk.arrive();
    await advanceTimers(1);

    expect(bar()).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
