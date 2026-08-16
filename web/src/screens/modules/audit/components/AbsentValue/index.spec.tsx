import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {AbsentValue} from './index';

describe('AbsentValue', () => {
  it('says what the dash means, because a dash says nothing', () => {
    render(
      <p>
        <AbsentValue />
      </p>,
    );

    expect(screen.getByText('Not recorded')).toBeInTheDocument();
  });

  it('keeps the glyph out of the accessible name, so it is not read twice', () => {
    const {container} = render(
      <p>
        <AbsentValue />
      </p>,
    );

    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('—');
  });
});
