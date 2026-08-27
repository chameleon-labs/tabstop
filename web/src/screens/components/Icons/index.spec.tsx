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

const isIcon = (entry: [string, unknown]): entry is [string, IconComponent] =>
  entry[0] !== 'SvgIcon' && typeof entry[1] === 'function';

const ICONS = Object.entries(Icons).filter(isIcon);

describe('the icon set', () => {
  it('exports every icon, so the checks below are not a sample', () => {
    expect(ICONS.length).toBe(20);
  });

  it('hides every one of them from assistive technology', () => {
    for (const [name, Icon] of ICONS) {
      expect(svgOf(<Icon />), name).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('draws every one on the grid its paths were authored against', () => {
    for (const [name, Icon] of ICONS) {
      expect(svgOf(<Icon />), name).toHaveAttribute('viewBox', '0 0 24 24');
    }
  });

  it('takes colour from the text each sits beside', () => {
    expect(svgOf(<AlertCircle />)).toHaveAttribute('stroke', 'currentColor');
  });

  it('gives each icon its own module, so a consumer can take one', () => {
    expect(svgOf(<Check />).querySelector('path')).not.toBeNull();
    expect(svgOf(<Globe />).querySelector('circle')).not.toBeNull();
  });
});
