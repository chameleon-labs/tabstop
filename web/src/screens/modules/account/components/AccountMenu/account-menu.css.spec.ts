// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {contrastBetween} from '@/test/contrast';

const styles = readFileSync('src/screens/modules/account/components/AccountMenu/account-menu.css', 'utf8');

const rule = (selector: string): string => {
  const match = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*{([^}]*)}`, 's').exec(styles);
  if (match?.[1] === undefined) {
    throw new Error(`no rule for ${selector}`);
  }
  return match[1];
};

describe('the account menu stylesheet', () => {
  it('pins the tick to the trailing edge', () => {
    // Without it the three ticks land at three different positions, which
    // jsdom cannot see.
    expect(rule('.account-menu__check')).toContain('margin-inline-start: auto');
  });

  it('reserves the tick a width, so the trailing edge does not jump', () => {
    expect(rule('.account-menu__check')).toMatch(/inline-size:\s*var\(--lat-font-size-xs\)/);
  });

  it('marks the selection with a tick and not a background', () => {
    // `[data-active-item]` already spends one on the keyboard's position.
    expect(styles).not.toMatch(/\[aria-checked=['"]true['"]\][^{]*{[^}]*background/s);
  });

  it('reads at AA in both themes, which the subtle ink did not', () => {
    // `--lat-text-subtle` here is 3.67:1 in dark and 6.61:1 in light, so
    // testing one theme would have passed it.
    const declared = rule('.account-menu__email');
    const ink = /color:\s*var\((--lat-[a-z-]+)\)/.exec(declared)?.[1];

    expect(ink).toBeDefined();
    for (const theme of ['light', 'dark'] as const) {
      expect(contrastBetween(ink!, '--lat-bg-raised', theme)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('sets the address at a size meant to be read', () => {
    // `2xs` is the badge rung; an address is read, not glanced at.
    expect(rule('.account-menu__email')).not.toContain('--lat-font-size-2xs');
    expect(rule('.account-menu__email')).not.toContain('--lat-font-size-3xs');
    expect(rule('.account-menu__email')).not.toContain('--lat-font-size-4xs');
  });
});
