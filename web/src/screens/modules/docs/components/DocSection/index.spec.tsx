import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {DocSection} from './index';

describe('DocSection', () => {
  it('provides an identified section, visible heading, and permalink while forwarding section props', () => {
    const {container} = render(
      <DocSection id="formula" title="The formula" className="formula-copy" data-purpose="formula-section">
        Body
      </DocSection>,
    );

    const section = container.querySelector('section#formula');

    expect(section).toHaveAttribute('data-purpose', 'formula-section');
    expect(section).toHaveClass('doc-section', 'formula-copy');
    expect(screen.getByRole('heading', {level: 2, name: /The formula/})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Permalink to The formula'})).toHaveAttribute('href', '#formula');
    expect(screen.getByText('#')).toHaveAttribute('aria-hidden', 'true');
  });
});
