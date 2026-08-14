import type {Impact} from '@tabstop/contract';
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {ImpactBadge} from './index';

const IMPACTS: readonly Impact[] = ['critical', 'serious', 'moderate', 'minor'];

describe('ImpactBadge', () => {
  it('names the severity, so it is not carried by colour alone', () => {
    for (const impact of IMPACTS) {
      const {unmount} = render(<ImpactBadge impact={impact} />);

      expect(screen.getByText(impact)).toBeVisible();
      unmount();
    }
  });

  it('takes its colour from the design system rather than a table of its own', () => {
    // Lattice names a variant per impact. A local palette here would drift from
    // every other severity in the app the first time one was retuned.
    for (const impact of IMPACTS) {
      const {container, unmount} = render(<ImpactBadge impact={impact} />);

      expect(container.querySelector('.lat-badge')).toHaveAttribute('data-variant', impact);
      unmount();
    }
  });

  it('carries an icon beside the word, for readers who cannot separate the four colours', () => {
    const {container} = render(<ImpactBadge impact="critical" />);

    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('reports a tally when given one', () => {
    render(<ImpactBadge impact="serious" count={5} />);

    expect(screen.getByText('5 serious')).toBeVisible();
  });
});

describe('a violation axe gave no severity', () => {
  it('says so rather than borrowing the lowest one', () => {
    // Reading an absent severity as "minor" hides findings that are findings.
    render(<ImpactBadge impact={null} />);

    expect(screen.getByText('unrated')).toBeVisible();
  });

  it('takes no severity colour, because it has no severity', () => {
    const {container} = render(<ImpactBadge impact={null} />);

    expect(container.querySelector('.lat-badge')).toHaveAttribute('data-variant', 'default');
  });
});
