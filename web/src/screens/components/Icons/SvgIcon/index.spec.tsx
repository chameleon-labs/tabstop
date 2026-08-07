import {render} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {SvgIcon} from './index';

const svgOf = (element: React.JSX.Element): SVGSVGElement => {
  const {container} = render(element);
  const svg = container.querySelector('svg');
  if (svg === null) throw new Error('no svg rendered');
  return svg;
};

describe('SvgIcon', () => {
  it('is the only svg in the set, and every icon renders through it', () => {
    const svg = svgOf(
      <SvgIcon>
        <path d="M0 0h24" />
      </SvgIcon>,
    );

    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelector('path')).not.toBeNull();
  });

  it('hides itself from assistive technology', () => {
    // Applied here rather than by each icon, which is the point: the previous
    // shape was a helper returning props, and nothing enforced that an icon
    // spread them. One that forgot put a decorative graphic into the tree.
    expect(
      svgOf(
        <SvgIcon>
          <path d="M0 0h24" />
        </SvgIcon>,
      ),
    ).toHaveAttribute('aria-hidden', 'true');
  });

  describe('the size scale', () => {
    it('defaults to the step that matches UI text', () => {
      expect(
        svgOf(
          <SvgIcon>
            <path d="M0 0h24" />
          </SvgIcon>,
        ),
      ).toHaveClass('icon', 'icon--md');
    });

    it('names each step rather than numbering it', () => {
      expect(
        svgOf(
          <SvgIcon size="sm">
            <path d="M0 0h24" />
          </SvgIcon>,
        ),
      ).toHaveClass('icon--sm');
      expect(
        svgOf(
          <SvgIcon size="lg">
            <path d="M0 0h24" />
          </SvgIcon>,
        ),
      ).toHaveClass('icon--lg');
    });

    it('carries no width or height of its own, so the scale cannot be bypassed', () => {
      // The dimensions come from `.icon` in the stylesheet, resolved from the
      // type tokens. An attribute here would beat the class and pin a pixel
      // size onto an icon that is meant to grow with the reader's text.
      const svg = svgOf(
        <SvgIcon size="lg">
          <path d="M0 0h24" />
        </SvgIcon>,
      );

      expect(svg).not.toHaveAttribute('width');
      expect(svg).not.toHaveAttribute('height');
    });

    it('keeps a caller class alongside the scale rather than instead of it', () => {
      // Two icons on the landing page are coloured through their own class.
      // Replacing the scale classes with it would silently unsize them.
      const svg = svgOf(
        <SvgIcon size="sm" className="landing-page__bool-check">
          <path d="M0 0h24" />
        </SvgIcon>,
      );

      expect(svg).toHaveClass('icon', 'icon--sm', 'landing-page__bool-check');
    });
  });
});
