import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import type {PageHistoryPoint} from '@tabstop/contract';
import {pointDate} from '../../trend-geometry';
import {AUDIT_LIST_LIMIT, AuditList} from './index';

const scored = (createdAt: string, score: number): PageHistoryPoint => ({
  auditId: `audit-${createdAt}`,
  createdAt,
  status: 'done',
  score,
  countsByImpact: {minor: 1, moderate: 0, serious: 0, critical: 0},
  axeVersion: '4.12.1',
});

const failed = (createdAt: string): PageHistoryPoint => ({
  auditId: `audit-${createdAt}`,
  createdAt,
  status: 'failed',
  score: null,
  countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
  axeVersion: null,
});

const OLDEST = '2026-08-01T10:00:00.000Z';
const MIDDLE = '2026-08-02T10:00:00.000Z';
const NEWEST = '2026-08-15T10:00:00.000Z';

const SERIES: PageHistoryPoint[] = [scored(OLDEST, 90), failed(MIDDLE), scored(NEWEST, 74)];

/** Day and hour cycle on different periods, so every timestamp below 168 is distinct. */
const many = (count: number): PageHistoryPoint[] =>
  Array.from({length: count}, (_, index) =>
    scored(
      `2026-05-${String((index % 28) + 1).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
      80,
    ),
  );

const rows = (): HTMLElement[] => screen.getAllByRole('listitem');

describe('AuditList', () => {
  it('reads newest first', () => {
    render(<AuditList points={SERIES} selectedAuditId={null} onSelect={vi.fn()} />);

    expect(rows().map((row) => row.querySelector('time')?.getAttribute('datetime'))).toEqual([NEWEST, MIDDLE, OLDEST]);
  });

  it('names what each control opens, rather than repeating "View result"', () => {
    // Three identical links are three identical entries in a list of links.
    render(<AuditList points={SERIES} selectedAuditId={null} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', {name: `View result for ${pointDate(SERIES[2]!)}`})).toBeVisible();
    expect(screen.getByRole('button', {name: `Why the audit failed on ${pointDate(SERIES[1]!)}`})).toBeVisible();
  });

  it('opens the audit its own control names', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AuditList points={SERIES} selectedAuditId={null} onSelect={onSelect} />);

    await user.click(screen.getByRole('button', {name: `View result for ${pointDate(SERIES[0]!)}`}));

    expect(onSelect).toHaveBeenCalledWith(SERIES[0]!.auditId);
  });

  it('marks the open audit, and marks nothing else', () => {
    render(<AuditList points={SERIES} selectedAuditId={SERIES[1]!.auditId} onSelect={vi.fn()} />);

    const current = screen.getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'true');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(`Why the audit failed on ${pointDate(SERIES[1]!)}`);
  });

  it('shows a failed run as failed, with no score beside it', () => {
    render(<AuditList points={SERIES} selectedAuditId={null} onSelect={vi.fn()} />);

    const row = rows()[1]!;
    expect(within(row).getByText('Failed')).toBeVisible();
    expect(within(row).queryByText('0')).not.toBeInTheDocument();
  });

  it('caps the list and says so, rather than printing a year of rows', () => {
    // A 365-day window is not a 365-row list.
    render(<AuditList points={many(45)} selectedAuditId={null} onSelect={vi.fn()} />);

    expect(rows()).toHaveLength(AUDIT_LIST_LIMIT);
    expect(screen.getByText(`Showing the ${AUDIT_LIST_LIMIT} most recent audits of 45.`)).toBeVisible();
  });

  it('says nothing about a cap it did not apply', () => {
    render(<AuditList points={many(AUDIT_LIST_LIMIT)} selectedAuditId={null} onSelect={vi.fn()} />);

    expect(rows()).toHaveLength(AUDIT_LIST_LIMIT);
    expect(screen.queryByText(/most recent audits of/)).not.toBeInTheDocument();
  });

  it('keeps the newest audits when it caps, not the oldest', () => {
    const points = many(45);
    render(<AuditList points={points} selectedAuditId={null} onSelect={vi.fn()} />);

    expect(rows()[0]?.querySelector('time')).toHaveAttribute('datetime', points[44]!.createdAt);
  });

  it('says the window is empty rather than showing an empty list', () => {
    render(<AuditList points={[]} selectedAuditId={null} onSelect={vi.fn()} />);

    expect(screen.getByText(/no audits in this window/i)).toBeVisible();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});
