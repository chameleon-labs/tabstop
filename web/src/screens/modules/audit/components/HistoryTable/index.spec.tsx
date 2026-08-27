import {render, screen, within} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import type {PageHistoryPoint} from '@tabstop/contract';
import {HistoryTable} from './index';

const scored = (createdAt: string, score: number, axeVersion = '4.12.1'): PageHistoryPoint => ({
  auditId: `audit-${createdAt}`,
  createdAt,
  status: 'done',
  score,
  countsByImpact: {minor: 1, moderate: 0, serious: 0, critical: 0},
  axeVersion,
});

const failed = (createdAt: string): PageHistoryPoint => ({
  auditId: `audit-${createdAt}`,
  createdAt,
  status: 'failed',
  score: null,
  countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
  axeVersion: null,
});

const OLDEST = '2026-07-01T10:00:00.000Z';
const MIDDLE = '2026-07-02T10:00:00.000Z';
const NEWEST = '2026-07-03T10:00:00.000Z';

const SERIES: PageHistoryPoint[] = [scored(OLDEST, 90), failed(MIDDLE), scored(NEWEST, 82)];

const renderTable = (points: readonly PageHistoryPoint[] = SERIES): void => {
  render(<HistoryTable points={points} domain="acme.example" days={90} />);
};

const bodyRows = (): HTMLElement[] => within(screen.getAllByRole('rowgroup')[1]!).getAllByRole('row');

const dateOf = (row: HTMLElement): string | null =>
  within(row).getByRole('rowheader').querySelector('time')?.getAttribute('datetime') ?? null;

describe('HistoryTable', () => {
  it('is a real table, captioned with the page and the window', () => {
    renderTable();

    expect(screen.getByRole('table', {name: 'Score history for acme.example, last 90 days'})).toBeVisible();
  });

  it('reads newest first, because a table is read from the top', () => {
    renderTable();

    expect(bodyRows().map(dateOf)).toEqual([NEWEST, MIDDLE, OLDEST]);
  });

  it('names and scopes every header', () => {
    renderTable();

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Date',
      'Score',
      'Change',
      'Status',
      'axe-core',
    ]);
    const unscoped = [...document.querySelectorAll('th')].filter((header) => !header.hasAttribute('scope'));
    expect(unscoped).toEqual([]);
  });

  it('shows a failed run as a gap, never as a zero', () => {
    renderTable();
    const cells = within(bodyRows()[1]!).getAllByRole('cell');

    expect(cells[0]).toHaveTextContent('—');
    expect(cells[0]).not.toHaveTextContent('0');
    expect(cells[1]).toHaveTextContent('—');
    expect(cells[1]).not.toHaveTextContent('0');
    expect(cells[2]).toHaveTextContent('Failed');
  });

  it('compares against the last run that finished, not the last run', () => {
    renderTable();

    expect(within(bodyRows()[0]!).getByText('Score down 8 points since the previous audit')).toBeInTheDocument();
  });

  it('says so rather than inventing a change for the first score in the window', () => {
    renderTable();

    expect(within(bodyRows()[2]!).getByText('First completed score')).toBeInTheDocument();
  });

  it('records the engine each run used, and says when it never got one', () => {
    renderTable();

    expect(within(bodyRows()[0]!).getAllByRole('cell')[3]).toHaveTextContent('4.12.1');
    expect(within(bodyRows()[1]!).getAllByRole('cell')[3]).toHaveTextContent('—');
  });

  it('scrolls sideways in its own region a keyboard can reach', () => {
    renderTable();
    const region = screen.getByRole('region', {name: 'Score history table'});

    expect(region).toHaveAttribute('tabindex', '0');
    expect(within(region).getByRole('table')).toBeInTheDocument();
  });

  it('says the window is empty rather than drawing an empty table', () => {
    renderTable([]);

    expect(screen.getByText(/no audits in this window/i)).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
