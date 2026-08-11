// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const styles = readFileSync('src/screens/modules/audit/pages/Home/landing.css', 'utf8');

describe('the landing page stylesheet', () => {
  it('ships only selectors used by the application landing page', () => {
    expect(styles).not.toContain('.system-page');
  });

  it('caps responsive grid tracks at the available inline size', () => {
    expect(styles).toContain('repeat(auto-fit, minmax(min(20rem, 100%), 1fr))');
    expect(styles).toContain('repeat(auto-fit, minmax(min(18rem, 100%), 1fr))');
  });

  it('contains decorative and intrinsically wide content at narrow widths', () => {
    expect(styles).toMatch(/\.landing-page__hero\s*{[^}]*overflow-x:\s*clip/s);
    expect(styles).toContain(
      '@media (width < 25rem) {\n  .landing-page__why-grid .lat-table {\n    table-layout: fixed;',
    );
  });
});
