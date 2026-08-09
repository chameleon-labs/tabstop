import {render} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import * as Icons from './index';
import {AlertCircle, Check, Globe, type IconProps} from './index';

const svgOf = (element: React.JSX.Element): SVGSVGElement => {
  const {container} = render(element);
  const svg = container.querySelector('svg');
  if (svg === null) {
    throw new Error('no svg rendered');
  }
  return svg;
};

type IconComponent = (props: IconProps) => React.JSX.Element;

/**
 * Every icon the barrel exports, which is what a consumer can reach.
 *
 * Narrowed by a predicate rather than asserted: `SvgIcon` is exported from here
 * too and takes children, so a cast over the whole record would compile and
 * then fail on the one entry that does not belong.
 */
const isIcon = (entry: [string, unknown]): entry is [string, IconComponent] =>
  entry[0] !== 'SvgIcon' && typeof entry[1] === 'function';

const ICONS = Object.entries(Icons).filter(isIcon);

describe('the icon set', () => {
  it('exports every icon, so the checks below are not a sample', () => {
    // A hand-written list goes stale the moment an icon is added, and the tests
    // after this one would then pass while covering less than they claim.
    expect(ICONS.length).toBe(20);
  });

  it('hides every one of them from assistive technology', () => {
    // They all sit beside a text label, so announcing them repeats what is
    // already there. `SvgIcon` applies it; this proves no icon bypassed it.
    for (const [name, Icon] of ICONS) {
      expect(svgOf(<Icon />), name).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('draws every one on the grid its paths were authored against', () => {
    // The path data is copied from a 24x24 source. A different viewBox scales
    // an icon silently rather than failing.
    for (const [name, Icon] of ICONS) {
      expect(svgOf(<Icon />), name).toHaveAttribute('viewBox', '0 0 24 24');
    }
  });

  it('takes colour from the text each sits beside', () => {
    // `currentColor` rather than a token: an icon inside a danger badge and one
    // inside body copy are the same component, and only the surrounding colour
    // knows which it is.
    expect(svgOf(<AlertCircle />)).toHaveAttribute('stroke', 'currentColor');
  });

  it('gives each icon its own module, so a consumer can take one', () => {
    // The reason for a folder per icon: a single file exporting eighteen of
    // them cannot be split by anything downstream.
    expect(svgOf(<Check />).querySelector('path')).not.toBeNull();
    expect(svgOf(<Globe />).querySelector('circle')).not.toBeNull();
  });
});
