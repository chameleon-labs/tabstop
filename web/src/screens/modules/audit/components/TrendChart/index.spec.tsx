import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import type {PageHistoryPoint} from '@tabstop/contract';
import {pointDescription, trendSummary} from '../../trend-geometry';
import {TrendChart} from './index';

const day = (index: number): string => `2026-07-${String(index).padStart(2, '0')}T12:00:00.000Z`;

const scored = (index: number, score: number, axeVersion = '4.11.0'): PageHistoryPoint => ({
  auditId: `audit-${index}`,
  createdAt: day(index),
  status: 'done',
  score,
  countsByImpact: {minor: 1, moderate: 0, serious: 0, critical: 0},
  axeVersion,
});

const failed = (index: number): PageHistoryPoint => ({
  auditId: `audit-${index}`,
  createdAt: day(index),
  status: 'failed',
  score: null,
  countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
  axeVersion: null,
});

const SERIES: PageHistoryPoint[] = [
  scored(1, 90),
  scored(2, 88),
  failed(3),
  scored(4, 74, '4.12.1'),
  scored(5, 76, '4.12.1'),
];

const markers = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>('.trend-chart__point'),
];

describe('TrendChart structure', () => {
  it('is a group with a text equivalent, so the points inside it stay reachable', () => {
    const {container} = render(<TrendChart points={SERIES} />);
    const plot = container.querySelector('svg');

    expect(plot).toHaveAttribute('role', 'group');
    expect(plot).toHaveAttribute('aria-label', trendSummary(SERIES));
  });

  it('breaks the line where an audit failed rather than drawing through it', () => {
    const {container} = render(<TrendChart points={SERIES} />);

    expect(container.querySelectorAll('polyline')).toHaveLength(2);
  });

  it('marks a failed run and gives it no vertex on the line', () => {
    const {container} = render(<TrendChart points={SERIES} />);
    const marker = screen.getByRole('img', {name: pointDescription(SERIES[2]!)});

    expect(marker).toHaveAccessibleName(/audit failed/);
    const vertices = [...container.querySelectorAll('polyline')].flatMap((line) =>
      (line.getAttribute('points') ?? '').split(' '),
    );
    expect(vertices).toHaveLength(4);
  });

  it('rules off where the engine version changed, once per change', () => {
    const {container} = render(<TrendChart points={SERIES} />);

    expect(container.querySelectorAll('.trend-chart__version')).toHaveLength(1);
  });

  it('rules off nothing when one engine version audited the whole window', () => {
    const {container} = render(<TrendChart points={[scored(1, 90), scored(2, 88)]} />);

    expect(container.querySelectorAll('.trend-chart__version')).toHaveLength(0);
  });

  it('says why the version rule matters, not just that it is there', () => {
    render(<TrendChart points={SERIES} />);

    expect(screen.getByText(/not directly comparable/i)).toBeVisible();
  });

  it('warns about nothing when the engine never changed', () => {
    render(<TrendChart points={[scored(1, 90), scored(2, 88)]} />);

    expect(screen.queryByText(/not directly comparable/i)).not.toBeInTheDocument();
  });

  it('marks where the series ends, and marks nothing else', () => {
    const {container} = render(<TrendChart points={SERIES} />);
    const ends = container.querySelectorAll('[data-endpoint="true"]');

    expect(ends).toHaveLength(1);
    expect(ends[0]).toHaveAccessibleName(pointDescription(SERIES[4]!));
  });

  it('labels both ends of the fitted axis, because the scale moves', () => {
    const {container} = render(<TrendChart points={SERIES} />);
    const axis = [...container.querySelectorAll('.trend-chart__axis-label')].map((label) => label.textContent);

    expect(axis).toContain('70');
    expect(axis).toContain('95');
  });

  it('says the window is empty rather than drawing an empty box', () => {
    const {container} = render(<TrendChart points={[]} />);

    expect(screen.getByText(/no audits in this window/i)).toBeVisible();
    expect(container.querySelector('svg')).not.toBeInTheDocument();
    expect(markers(container)).toHaveLength(0);
  });
});

describe('TrendChart keyboard', () => {
  it('holds a single tab stop, whichever point is current', async () => {
    const user = userEvent.setup();
    const {container} = render(<TrendChart points={SERIES} />);

    expect(markers(container).map((point) => point.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1']);

    await user.tab();
    await user.keyboard('{ArrowRight}');

    expect(markers(container).map((point) => point.getAttribute('tabindex'))).toEqual(['-1', '0', '-1', '-1', '-1']);
  });

  it('moves one point at a time with the arrow keys', async () => {
    const user = userEvent.setup();
    const {container} = render(<TrendChart points={SERIES} />);
    const points = markers(container);

    await user.tab();
    expect(document.activeElement).toBe(points[0]);

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toBe(points[2]);

    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(points[1]);
  });

  it('jumps to the first and last point', async () => {
    const user = userEvent.setup();
    const {container} = render(<TrendChart points={SERIES} />);
    const points = markers(container);

    await user.tab();
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(points[4]);

    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(points[0]);
  });

  it('stops at each end rather than wrapping round', async () => {
    const user = userEvent.setup();
    const {container} = render(<TrendChart points={SERIES} />);
    const points = markers(container);

    await user.tab();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(document.activeElement).toBe(points[0]);

    await user.keyboard('{End}{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toBe(points[4]);
  });

  it('announces the point it moved to', async () => {
    const user = userEvent.setup();
    const onFocusPoint = vi.fn();
    render(<TrendChart points={SERIES} onFocusPoint={onFocusPoint} />);

    await user.tab();
    await user.keyboard('{ArrowRight}');

    expect(onFocusPoint).toHaveBeenLastCalledWith(pointDescription(SERIES[1]!));
  });

  it('names every point, so it reads even when reached another way', () => {
    render(<TrendChart points={SERIES} />);

    for (const point of SERIES) {
      expect(screen.getByRole('img', {name: pointDescription(point)})).toBeInTheDocument();
    }
  });
});

describe('TrendChart pointer', () => {
  it('shows the point under the pointer and drops it again', async () => {
    const user = userEvent.setup();
    const {container} = render(<TrendChart points={SERIES} />);
    const tooltip = (): Element | null => container.querySelector('.trend-chart__tooltip');

    expect(tooltip()).not.toBeInTheDocument();

    await user.hover(markers(container)[1]!);
    expect(tooltip()).toHaveTextContent('88');

    await user.unhover(markers(container)[1]!);
    expect(tooltip()).not.toBeInTheDocument();
  });

  it('does not take focus away from wherever it was', async () => {
    const user = userEvent.setup();
    const {container} = render(<TrendChart points={SERIES} />);

    await user.hover(markers(container)[1]!);

    expect(document.activeElement).toBe(document.body);
  });

  it('announces nothing on hover, which would talk over whatever is being read', async () => {
    const user = userEvent.setup();
    const onFocusPoint = vi.fn();
    const {container} = render(<TrendChart points={SERIES} onFocusPoint={onFocusPoint} />);

    await user.hover(markers(container)[1]!);

    expect(onFocusPoint).not.toHaveBeenCalled();
  });

  it('anchors the tooltip by its near edge, so it cannot leave the chart', async () => {
    const user = userEvent.setup();
    const {container} = render(<TrendChart points={SERIES} />);
    const tooltip = (): HTMLElement | null => container.querySelector<HTMLElement>('.trend-chart__tooltip');

    await user.hover(markers(container)[0]!);
    expect(tooltip()?.style.left).not.toBe('');
    expect(tooltip()?.style.right).toBe('');

    await user.unhover(markers(container)[0]!);
    await user.hover(markers(container)[4]!);
    expect(tooltip()?.style.right).not.toBe('');
    expect(tooltip()?.style.left).toBe('');
  });

  it('drops below a point near the top rather than over the heading above it', async () => {
    const user = userEvent.setup();
    const {container} = render(<TrendChart points={SERIES} />);

    await user.hover(markers(container)[0]!);
    expect(container.querySelector('.trend-chart__tooltip')).toHaveAttribute('data-place', 'below');

    await user.unhover(markers(container)[0]!);
    await user.hover(markers(container)[2]!);
    expect(container.querySelector('.trend-chart__tooltip')).toHaveAttribute('data-place', 'above');
  });

  it('shows the same tooltip for the point the keyboard reached', async () => {
    const user = userEvent.setup();
    const {container} = render(<TrendChart points={SERIES} />);

    await user.tab();
    await user.keyboard('{ArrowRight}{ArrowRight}');

    expect(container.querySelector('.trend-chart__tooltip')).toHaveTextContent(/audit failed/i);
  });
});
