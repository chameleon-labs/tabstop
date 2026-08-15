import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {ScoreDelta} from './index';

describe('ScoreDelta', () => {
  it.each([
    {score: 74, previousScore: 82, visible: '↓ 8', label: 'Score down 8 points since the previous audit'},
    {score: 93, previousScore: 90, visible: '↑ 3', label: 'Score up 3 points since the previous audit'},
    {score: 90, previousScore: 90, visible: 'No change', label: 'Score unchanged since the previous audit'},
    {score: 90, previousScore: null, visible: 'First score', label: 'First completed score'},
  ])('renders $visible without relying on color', ({score, previousScore, visible, label}) => {
    render(<ScoreDelta score={score} previousScore={previousScore} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(visible)).toBeVisible();
  });

  it('says point, not points, for a single point', () => {
    render(<ScoreDelta score={90} previousScore={91} />);

    expect(screen.getByText('Score down 1 point since the previous audit')).toBeInTheDocument();
    expect(screen.getByText('↓ 1')).toBeVisible();
  });

  it.each([
    {score: 74, previousScore: 82, variant: 'danger'},
    {score: 93, previousScore: 90, variant: 'success'},
    {score: 90, previousScore: 90, variant: 'default'},
    {score: 90, previousScore: null, variant: 'default'},
  ])('reinforces $variant with colour, having already said it in text', ({score, previousScore, variant}) => {
    const {container} = render(<ScoreDelta score={score} previousScore={previousScore} />);

    expect(container.querySelector('.score-delta')).toHaveAttribute('data-variant', variant);
  });

  it('hides the arrow glyph, because the wrapper label already carries the direction', () => {
    // Announced as-is, the glyph reads as "down arrow 8" ahead of a label that
    // says the same thing in words.
    const {container} = render(<ScoreDelta score={74} previousScore={82} />);

    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('↓');
  });

  it('carries its sentence as text, which a bare span may do and aria-label may not', () => {
    // ARIA prohibits aria-label on a span with no role, so the name computed
    // in jsdom was one no browser is required to expose.
    const {container} = render(<ScoreDelta score={74} previousScore={82} />);

    expect(container.querySelector('.score-delta')).not.toHaveAttribute('aria-label');
    expect(screen.getByText('Score down 8 points since the previous audit')).toBeInTheDocument();
  });
});
