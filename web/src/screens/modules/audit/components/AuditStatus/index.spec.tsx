import {act, render, screen, within} from '@testing-library/react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AuditStatus} from './index';
import {ANNOUNCE_DELAY_MS} from '@/a11y/announce';

const region = (): HTMLElement => screen.getByRole('status');

describe('AuditStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const settle = (): void => {
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    });
  };

  it('is ONE node, both seen and announced', () => {
    render(<AuditStatus message="Fetching the page" />);
    settle();

    expect(screen.getAllByText(/Fetching the page/)).toHaveLength(1);
    expect(region()).toHaveTextContent('Fetching the page');
    expect(region()).toBeVisible();
    expect(region()).not.toHaveAttribute('class');
  });

  it('can advance visible copy without announcing a synthetic phase', () => {
    render(<AuditStatus message={null} visibleMessage="Scoring…" />);

    expect(screen.getByText('Scoring…')).toHaveAttribute('aria-hidden', 'true');
    expect(region().querySelector('.visually-hidden')).toBeEmptyDOMElement();
  });

  it('keeps announced copy delayed when visible copy is immediate', () => {
    render(
      <AuditStatus
        message="Fetching the page… this usually takes about 30 seconds"
        visibleMessage="Fetching the page…"
      />,
    );

    expect(screen.getByText('Fetching the page…')).toBeVisible();
    expect(within(region()).queryByText(/30 seconds/)).not.toBeInTheDocument();

    settle();
    expect(within(region()).getByText(/30 seconds/, {selector: '.visually-hidden'})).toBeInTheDocument();
  });

  it('renders empty, so the region exists before its first content', () => {
    const initial = renderToStaticMarkup(<AuditStatus message="Fetching the page" />);

    expect(initial).toContain('role="status"');
    expect(initial).not.toContain('Fetching the page');
  });

  it('defers the write to a later task', () => {
    render(<AuditStatus message="Requesting the audit" />);

    expect(region()).toBeEmptyDOMElement();

    settle();
    expect(region()).toHaveTextContent('Requesting the audit');
  });

  it('stays mounted with nothing to say, before an audit and after one', () => {
    render(<AuditStatus message={null} />);

    expect(region()).toBeInTheDocument();
    expect(region()).toBeEmptyDOMElement();
  });

  it('clears the line when there is nothing left to say', () => {
    const {rerender} = render(<AuditStatus message="Scoring" />);
    settle();

    rerender(<AuditStatus message={null} />);
    settle();

    expect(region()).toBeEmptyDOMElement();
  });

  it('keeps a completion message once the audit has finished', () => {
    const complete = 'Audit complete. Score 72. 1 issue found.';
    const {rerender} = render(<AuditStatus message={complete} />);
    settle();

    rerender(<AuditStatus message={complete} />);
    settle();

    expect(region()).toHaveTextContent('Audit complete. Score 72.');
  });

  it('changes only when the message changes', () => {
    const {rerender} = render(<AuditStatus message="Scoring" />);
    settle();

    const seen: string[] = [];
    const drain = (records: MutationRecord[]): void => {
      for (const record of records) {
        seen.push(record.oldValue ?? '');
      }
    };
    const observer = new MutationObserver(drain);
    observer.observe(region(), {
      childList: true,
      characterData: true,
      characterDataOldValue: true,
      subtree: true,
    });

    for (let i = 0; i < 5; i += 1) {
      rerender(<AuditStatus message="Scoring" />);
    }
    settle();
    drain(observer.takeRecords());
    observer.disconnect();

    expect(seen).toEqual([]);
  });

  it('is polite, because none of this should interrupt', () => {
    render(<AuditStatus message="Scoring" />);

    expect(region()).toHaveAttribute('aria-live', 'polite');
  });
});
