// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const BASE = 'src/screens/components/BrandMark/brand-mark.css';
const AUTH = 'src/screens/modules/account/components/AuthShell/auth-shell.css';
const LANDING = 'src/screens/modules/audit/pages/Home/landing.css';

const brandMark = readFileSync(BASE, 'utf8');
const authShell = readFileSync(AUTH, 'utf8');
const landing = readFileSync(LANDING, 'utf8');

describe('the brand mark stylesheet', () => {
  it('sizes both boxes from spacing rungs', () => {
    expect(brandMark).toContain("[data-size='md']");
    expect(brandMark).toContain("[data-size='sm']");
    expect(brandMark).toContain('var(--lat-space-8)');
    expect(brandMark).toContain('var(--lat-space-6)');
  });

  it('applies one corner radius to every size', () => {
    expect(brandMark).toContain('var(--lat-radius-sm)');
    expect(brandMark).not.toContain('var(--lat-radius-none)');
  });

  it('leaves no mark rules behind at either call site', () => {
    expect(authShell).not.toContain('.auth-page__brand-mark');
    expect(landing).not.toContain('.landing-page__logo-mark {');
  });
});
