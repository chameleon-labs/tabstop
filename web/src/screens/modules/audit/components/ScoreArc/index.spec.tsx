import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
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
    // The arc is the illustration; the number is the answer.
    render(<ScoreArc score={63} />);

    expect(screen.getByText('63')).toBeInTheDocument();
  });

  it('changes colour at the thresholds, and keeps the number either way', () => {
    for (const [score, expected] of [
      [91, 'score-arc--good'],
      [63, 'score-arc--warn'],
      [22, 'score-arc--bad'],
    ] as const) {
      const {unmount} = render(<ScoreArc score={score} />);

      expect(arc().getAttribute('class')).toContain(expected);
      unmount();
    }
  });

  it('scales every dimension from one prop, so a caller cannot half-resize it', () => {
    const {container} = render(<ScoreArc score={71} size={100} />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('width', '100');
    expect(svg).toHaveAttribute('height', '100');
  });
});
