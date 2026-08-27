// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const BASE = 'src/screens/components/BrandMark/brand-mark.css';
const AUTH = 'src/screens/modules/account/components/AuthShell/auth-shell.css';
const LANDING = 'src/screens/modules/audit/pages/Home/landing.css';

const LANDING_TSX = 'src/screens/modules/audit/pages/Home/landing.tsx';
const AUTH_TSX = 'src/screens/modules/account/components/AuthShell/index.tsx';

const brandMark = readFileSync(BASE, 'utf8');
const authShell = readFileSync(AUTH, 'utf8');
const landing = readFileSync(LANDING, 'utf8');
const landingTsx = readFileSync(LANDING_TSX, 'utf8');
const authTsx = readFileSync(AUTH_TSX, 'utf8');

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

  it('leaves no mark rules behind at any call site', () => {
    expect(authShell).not.toContain('.auth-page__brand-mark');
    expect(landing).not.toContain('.landing-page__logo-mark {');
  });

  it('leaves no markup referring to the rules it deleted', () => {
    expect(landingTsx).not.toContain('landing-page__logo-mark');
    expect(authTsx).not.toContain('auth-page__brand-mark');
  });
});
