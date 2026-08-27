import {act, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useAuditPhase} from './use-audit-phase';
import type {ProgressStatus} from '../phase';

const START = 1_700_000_000_000;

const Harness = ({status}: {status: ProgressStatus}): React.JSX.Element => {
  const phase = useAuditPhase(status, START, true);
  return <p data-testid="phase">{phase}</p>;
};

describe('useAuditPhase, as it reaches the screen', () => {
  beforeEach(() => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never puts a later phase on screen before an earlier one', async () => {
    const {rerender} = render(<Harness status="queued" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });

    const node = screen.getByTestId('phase');
    const seen: string[] = [];
    const drain = (records: MutationRecord[]): void => {
      for (const record of records) {
        if (record.oldValue !== null && record.oldValue !== undefined) {
          seen.push(record.oldValue);
        }
        for (const removed of record.removedNodes) {
          seen.push(removed.textContent ?? '');
        }
      }
    };
    const observer = new MutationObserver(drain);
    observer.observe(node, {
      childList: true,
      characterData: true,
      characterDataOldValue: true,
      subtree: true,
    });

    rerender(<Harness status="running" />);
    drain(observer.takeRecords());
    observer.disconnect();

    const everyValue = [...seen, node.textContent ?? ''];
    expect(everyValue).not.toContain('Scoring');
    expect(everyValue.at(-1)).toBe('Fetching the page');
  });
});
