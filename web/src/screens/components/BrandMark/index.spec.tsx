import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {BrandMark} from './index';

describe('the brand mark', () => {
  it('renders the tabstop glyph', () => {
    render(<BrandMark />);

    expect(screen.getByText('t/')).toBeInTheDocument();
  });

  it('hides the mark from assistive technology', () => {
    render(<BrandMark />);

    expect(screen.getByText('t/')).toHaveAttribute('aria-hidden', 'true');
  });

  it('defaults to the larger box', () => {
    render(<BrandMark />);

    expect(screen.getByText('t/')).toHaveAttribute('data-size', 'md');
  });

  it('carries the requested size for the stylesheet to key on', () => {
    render(<BrandMark size="sm" />);

    expect(screen.getByText('t/')).toHaveAttribute('data-size', 'sm');
  });

  it('keeps a caller class alongside its own', () => {
    render(<BrandMark className="landing-page__logo-mark" />);

    const mark = screen.getByText('t/');

    expect(mark).toHaveClass('brand-mark');
    expect(mark).toHaveClass('landing-page__logo-mark');
  });
});
