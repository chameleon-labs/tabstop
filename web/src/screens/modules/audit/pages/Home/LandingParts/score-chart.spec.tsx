import {render} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ScoreChart} from './score-chart';

const DATA = [
  {date: 'Jul 1', score: 91},
  {date: 'Jul 21', score: 61},
  {date: 'Aug 2', score: 71},
];

const measuring = (width: number): void => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(_target: Element): void {
        this.callback([{contentRect: {width}} as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }

      unobserve(): void {}

      disconnect(): void {}
    },
  );
};

const svgOf = (container: HTMLElement): SVGSVGElement => {
  const svg = container.querySelector('svg');
  if (svg === null) {
    throw new Error('no svg rendered');
  }
  return svg;
};

describe('ScoreChart', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws nothing until it has been measured', () => {
    const {container} = render(<ScoreChart data={DATA} referenceDate="Jul 21" />);

    expect(svgOf(container).querySelector('path')).toBeNull();
  });

  it('plots a point per audit once it knows how wide it is', () => {
    measuring(600);

    const {container} = render(<ScoreChart data={DATA} referenceDate="Jul 21" />);

    expect(container.querySelectorAll('circle')).toHaveLength(DATA.length);
    expect(svgOf(container).querySelector('path')?.getAttribute('d')).toMatch(/^M/);
  });

  it('labels both axes with the values they carry', () => {
    measuring(600);

    const {container} = render(<ScoreChart data={DATA} referenceDate="Jul 21" />);
    const labels = [...container.querySelectorAll('text')].map((node) => node.textContent);

    for (const date of DATA.map((point) => point.date)) {
      expect(labels).toContain(date);
    }
    expect(labels).toContain('50');
    expect(labels).toContain('100');
  });

  it('marks the reference date, and only when the data contains it', () => {
    measuring(600);

    const {container: withMark} = render(<ScoreChart data={DATA} referenceDate="Jul 21" />);
    const {container: without} = render(<ScoreChart data={DATA} referenceDate="Not a date in the data" />);

    expect(withMark.querySelectorAll('line')).not.toHaveLength(0);
    expect(without.querySelectorAll('line')).toHaveLength(0);
  });

  it('stays out of the accessibility tree, because the table beside it is the equivalent', () => {
    measuring(600);

    const {container} = render(<ScoreChart data={DATA} referenceDate="Jul 21" />);

    expect(svgOf(container)).toHaveAttribute('aria-hidden', 'true');
  });
});
