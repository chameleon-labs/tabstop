import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {Prose} from './index';

describe('Prose', () => {
  it('renders readable copy in a paragraph and forwards ordinary paragraph props', () => {
    render(
      <Prose className="intro-copy" data-purpose="intro">
        Readable copy
      </Prose>,
    );

    const copy = screen.getByText('Readable copy');

    expect(copy).toMatchObject({tagName: 'P'});
    expect(copy).toHaveAttribute('data-purpose', 'intro');
    expect(copy).toHaveClass('docs-prose', 'intro-copy');
  });
});
