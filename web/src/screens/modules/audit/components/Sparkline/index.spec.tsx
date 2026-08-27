import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import type {PageScorePoint} from '@tabstop/contract';
import {Sparkline, sparklineCoordinates, sparklineLabel} from './index';

const at = '2026-08-15T10:00:00.000Z';
const point = (score: number): PageScorePoint => ({score, at});

describe('sparklineCoordinates', () => {
  it('centres a single point rather than pinning it to the left edge', () => {
    expect(sparklineCoordinates([point(100)])).toEqual([{x: 60, y: 2}]);
  });

  it('spans the drawable width and the whole fixed score domain', () => {
    expect(sparklineCoordinates([point(100), point(0)])).toEqual([
      {x: 2, y: 2},
      {x: 118, y: 34},
    ]);
  });

  it('scales y from a fixed 0..100 domain, not the local range', () => {
    expect(sparklineCoordinates([point(60), point(50)])).toEqual([
      {x: 2, y: 14.8},
      {x: 118, y: 18},
    ]);
  });

  it('draws a constant series as a flat line', () => {
    expect(sparklineCoordinates([point(80), point(80), point(80)])).toEqual([
      {x: 2, y: 8.4},
      {x: 60, y: 8.4},
      {x: 118, y: 8.4},
    ]);
  });

  it('clamps a score outside the documented domain instead of drawing outside the box', () => {
    expect(sparklineCoordinates([point(140), point(-20)])).toEqual([
      {x: 2, y: 2},
      {x: 118, y: 34},
    ]);
  });

  it('keeps only the newest 30 points', () => {
    const many = Array.from({length: 31}, (_, index) => point(index));

    expect(sparklineCoordinates(many)).toHaveLength(30);
  });

  it('produces no geometry for no history', () => {
    expect(sparklineCoordinates([])).toEqual([]);
  });
});

describe('sparklineLabel', () => {
  it.each([
    {name: 'a decline', points: [point(86), point(74)], label: 'Score trend: 86 to 74 over 2 audits, down 12 points'},
    {name: 'a rise', points: [point(74), point(86)], label: 'Score trend: 74 to 86 over 2 audits, up 12 points'},
    {name: 'no movement', points: [point(74), point(74)], label: 'Score trend: 74 to 74 over 2 audits, unchanged'},
    {name: 'one audit', points: [point(74)], label: 'Score trend: 74 from 1 audit'},
    {name: 'no audits', points: [], label: 'No completed score history'},
  ])('summarises $name', ({points, label}) => {
    expect(sparklineLabel(points)).toBe(label);
  });

  it('counts only the points it draws', () => {
    const many = Array.from({length: 31}, () => point(50));

    expect(sparklineLabel(many)).toBe('Score trend: 50 to 50 over 30 audits, unchanged');
  });

  it('says point, not points, for a single-point move', () => {
    expect(sparklineLabel([point(75), point(74)])).toBe('Score trend: 75 to 74 over 2 audits, down 1 point');
  });
});

describe('Sparkline', () => {
  it('is one image with a text equivalent, not a pile of unnamed shapes', () => {
    render(<Sparkline points={[point(74)]} />);

    expect(screen.getByRole('img', {name: 'Score trend: 74 from 1 audit'})).toBeVisible();
  });

  it('marks a single audit with a dot, since a line needs two points', () => {
    const {container} = render(<Sparkline points={[point(74)]} />);

    expect(container.querySelectorAll('circle')).toHaveLength(1);
    expect(container.querySelector('polyline')).not.toBeInTheDocument();
  });

  it('draws a line and marks where the series ends', () => {
    const {container} = render(<Sparkline points={[point(86), point(74)]} />);

    expect(container.querySelector('polyline')).toHaveAttribute('points', '2,6.48 118,10.32');
    expect(container.querySelectorAll('circle')).toHaveLength(1);
  });

  it('keeps its stroke width when the row scales the box', () => {
    const {container} = render(<Sparkline points={[point(86), point(74)]} />);

    expect(container.querySelector('polyline')).toHaveAttribute('vector-effect', 'non-scaling-stroke');
  });

  it('renders no score geometry at all when there is no history', () => {
    const {container} = render(<Sparkline points={[]} />);

    expect(screen.getByRole('img', {name: 'No completed score history'})).toBeVisible();
    expect(container.querySelector('polyline')).not.toBeInTheDocument();
    expect(container.querySelectorAll('circle')).toHaveLength(0);
  });

  it.each([
    {name: 'a decline', points: [point(86), point(74)], trend: 'down'},
    {name: 'a rise', points: [point(74), point(86)], trend: 'up'},
    {name: 'no movement', points: [point(74), point(74)], trend: 'flat'},
    {name: 'one audit', points: [point(74)], trend: 'single'},
    {name: 'no audits', points: [], trend: 'empty'},
  ])('exposes $trend for styling $name', ({points, trend}) => {
    const {container} = render(<Sparkline points={points} />);

    expect(container.querySelector('svg')).toHaveAttribute('data-trend', trend);
  });

  it('stays out of the tab order and keeps its fixed box', () => {
    const {container} = render(<Sparkline points={[point(74)]} />);
    const svg = container.querySelector('svg')!;

    expect(svg).toHaveAttribute('viewBox', '0 0 120 36');
    expect(svg).toHaveAttribute('focusable', 'false');
  });
});
