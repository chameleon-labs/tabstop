// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const styles = readFileSync('src/screens/components/SiteHeader/site-header.css', 'utf8');
const landing = readFileSync('src/screens/modules/audit/pages/Home/landing.css', 'utf8');
const appStyles = readFileSync('src/styles.css', 'utf8');

describe('the site header stylesheet', () => {
  it('makes room for both auth actions at the narrowest supported viewport', () => {
    // The account controls cannot disappear at 25rem, so the brand does.
    expect(styles).toContain('@media (width < 25rem)');
    expect(styles).toContain('.site-header__brand .lat-badge');
    expect(styles).toContain('padding-inline: var(--lat-space-4)');
  });

  it('layers above positioned page content while sticky', () => {
    // With `z-index: auto` the landing hero's card scrolls over it.
    expect(styles).toMatch(/\.site-header\s*{[^}]*z-index:\s*50/s);
    expect(styles).toMatch(/\.site-header\s*{[^}]*position:\s*sticky/s);
  });

  it('tracks the page gutter at every step, so the header lines up with the content', () => {
    // The same rungs the page sections step through, so the two line up.
    for (const rung of ['--lat-space-6', '--lat-space-10', '--lat-space-12'] as const) {
      expect(styles).toContain(rung);
      expect(landing).toContain(rung);
    }
    for (const query of ['@media (width >= 48rem)', '@media (width >= 64rem)'] as const) {
      expect(styles).toContain(query);
    }
  });

  it('leaves no header rules behind where it took them from', () => {
    // A surviving copy is a second header's rules that nothing renders.
    expect(landing).not.toContain('.landing-page__nav');
    expect(landing).not.toContain('.landing-page__logo-text');
    expect(appStyles).not.toContain('.site-header {');
    expect(appStyles).not.toContain('.wordmark');
  });

  it('lets the row grow, because the account nav can hold an error', () => {
    // A revoke failure puts a Callout in the nav. At a fixed 3.5rem the row
    // cannot hold it and `align-items: center` spills it out of both ends.
    // Only the property is asserted: jsdom computes no layout, so nothing in
    // this suite can see the overflow itself.
    expect(styles).toMatch(/\.site-header__inner\s*{[^}]*min-block-size:\s*3\.5rem/s);
    expect(styles).not.toMatch(/\.site-header__inner\s*{[^}]*[^-]block-size:\s*3\.5rem/s);
  });

  it('leaves the full-height column to the shell', () => {
    // Below a shared header, `100vh` here stacks into `100vh + 3.5rem`.
    expect(landing).not.toMatch(/\.landing-page\s*{[^}]*min-block-size:\s*100vh/s);
    expect(appStyles).toMatch(/\.app-shell\s*{[^}]*min-block-size:\s*100vh/s);
  });
});
