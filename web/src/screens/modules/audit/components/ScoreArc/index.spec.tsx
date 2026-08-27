import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {Providers} from '@/test/render';
import {ScoreArc} from './index';

const arc = (): Element => {
  const found = document.querySelector('.score-arc');
  if (found === null) {
    throw new Error('no arc rendered');
  }
  return found;
};

describe('ScoreArc', () => {
  it('shows the score as a number, not only as a sweep', () => {
    render(<ScoreArc score={63} />, {wrapper: Providers});

    expect(screen.getByText('63')).toBeInTheDocument();
  });

  it('changes colour at the thresholds, and keeps the number either way', () => {
    for (const [score, expected] of [
      [91, 'score-arc--good'],
      [63, 'score-arc--warn'],
      [22, 'score-arc--bad'],
    ] as const) {
      const {unmount} = render(<ScoreArc score={score} />, {wrapper: Providers});

      expect(arc().getAttribute('class')).toContain(expected);
      unmount();
    }
  });

  it('scales every dimension from one prop, so a caller cannot half-resize it', () => {
    const {container} = render(<ScoreArc score={71} size={100} />, {wrapper: Providers});
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('width', '100');
    expect(svg).toHaveAttribute('height', '100');
  });

  it('links its score explanation without adding another tab stop', () => {
    render(<ScoreArc score={71} />, {wrapper: Providers});

    const link = screen.getByRole('link', {name: 'How score 71 out of 100 is calculated'});
    expect(link).toHaveAttribute('href', '/docs/score-formula');
    expect(screen.getAllByRole('link')).toEqual([link]);
    expect(link.querySelector('.score-arc__help')).toHaveAttribute('aria-hidden', 'true');
  });
});
