// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const read = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

const pageCss = (): string => stripComments(read('./score-formula.css'));
const docSectionCss = (): string => stripComments(read('../../components/DocSection/doc-section.css'));
const sectionNavCss = (): string => stripComments(read('../../components/SectionNav/section-nav.css'));
const docsCss = (): string => [pageCss(), docSectionCss(), sectionNavCss()].join('\n');

const ruleBodies = (css: string, selector: RegExp): string[] => {
  const pattern = new RegExp(`${selector.source}\\s*\\{([^{}]*)\\}`, 'gs');
  return [...css.matchAll(pattern)].map((match) => match[1] ?? '');
};

const ruleBody = (css: string, selector: RegExp, occurrence = 0): string => {
  const body = ruleBodies(css, selector)[occurrence];
  expect(body, `missing CSS rule ${selector.source}`).toBeDefined();
  return body ?? '';
};

const fromMedia = (css: string, query: string): string => {
  const start = css.indexOf(`@media (${query})`);
  expect(start, `missing @media (${query})`).toBeGreaterThanOrEqual(0);
  return css.slice(start);
};

describe('ScoreFormula visual contract', () => {
  it('uses Lattice tokens rather than raw colors or locally declared custom tokens', () => {
    const css = docsCss();

    expect(css).not.toMatch(/#[\da-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch)\(/i);
    expect(css).not.toMatch(/--[a-z0-9_-]+\s*:/i);
  });

  it('ties page composition roles to the corresponding Lattice tokens', () => {
    const css = pageCss();

    expect(ruleBody(css, /\.score-formula__container/)).toMatch(/max-inline-size:\s*var\(--lat-container-content\)/);
    expect(ruleBody(css, /\.score-formula__header/)).toMatch(/max-inline-size:\s*var\(--lat-container-prose\)/);
    expect(ruleBody(css, /\.score-formula__title/)).toMatch(
      /font-family:\s*var\(--lat-text-h1-font-family\)[\s\S]*font-size:\s*var\(--lat-text-h1-font-size\)[\s\S]*font-weight:\s*var\(--lat-text-h1-font-weight\)/,
    );
    expect(ruleBody(css, /\.score-formula__lede/)).toMatch(
      /color:\s*var\(--lat-text-subtle\)[\s\S]*font-family:\s*var\(--lat-text-lead-font-family\)/,
    );
    expect(ruleBody(css, /\.score-formula__formula-card\s*,\s*\.score-formula__example-card/)).toMatch(
      /border-color:\s*var\(--lat-border-strong\)[\s\S]*border-radius:\s*var\(--lat-radius-sm\)[\s\S]*background:\s*var\(--lat-bg-raised\)/,
    );
    expect(ruleBody(css, /\.score-formula__formula-body/)).toMatch(
      /gap:\s*var\(--lat-space-3\)[\s\S]*background:\s*var\(--lat-bg-subtle\)/,
    );
    expect(
      ruleBody(css, /\.score-formula__back-link:focus-visible\s*,\s*\.score-formula__table-scroll:focus-visible/),
    ).toMatch(/outline:\s*2px solid var\(--lat-focus-ring\)/);
    expect(ruleBody(css, /\.score-formula__impact-text--critical/)).toMatch(/color:\s*var\(--lat-severity-critical\)/);
    expect(ruleBody(css, /\.score-formula__impact-text--serious/)).toMatch(/color:\s*var\(--lat-severity-serious\)/);
    expect(ruleBody(css, /\.score-formula__impact-text--minor/)).toMatch(/color:\s*var\(--lat-severity-minor\)/);
    expect(ruleBody(css, /\.score-formula__back-link/)).toMatch(
      /transition:\s*color var\(--lat-duration-default\) var\(--lat-easing-out\)/,
    );
  });

  it('promotes every small or subtle score-page label to the accessible text token', () => {
    const css = pageCss();
    const contrastOverride = css.match(/\.score-formula\s+:is\(([\s\S]*?)\)\s*\{\s*color:\s*var\(--lat-text\);\s*\}/);
    const contrastOverrideSelectors = (contrastOverride?.[1] ?? '')
      .split(',')
      .map((selector) => selector.trim())
      .filter(Boolean);

    for (const selector of [
      '.lat-eyebrow__text',
      '.lat-badge[data-variant]',
      '.section-nav__link',
      '.docs-prose',
      '.docs-prose a',
      '.lat-table__caption',
      '.lat-table__header',
      '.score-formula__cap-note',
      '.score-formula__impact-text',
    ]) {
      expect(css).toContain(selector);
      expect(contrastOverrideSelectors).toContain(selector);
    }
    expect(css).toMatch(/\.score-formula\s+:is\([\s\S]*\)\s*\{\s*color:\s*var\(--lat-text\);/);
  });

  it('ties DocSection roles to their Lattice type, spacing, border, focus, and motion tokens', () => {
    const css = docSectionCss();

    expect(ruleBody(css, /\.doc-section/)).toMatch(
      /scroll-margin-block-start:\s*var\(--lat-space-24\)[\s\S]*padding-block:\s*var\(--lat-space-8\)[\s\S]*border-block-start:\s*1px solid var\(--lat-border\)/,
    );
    expect(ruleBody(css, /\.doc-section__heading/)).toMatch(
      /gap:\s*var\(--lat-space-2\)[\s\S]*font-family:\s*var\(--lat-text-h2-font-family\)[\s\S]*font-size:\s*var\(--lat-text-h2-font-size\)/,
    );
    expect(ruleBody(css, /\.doc-section__permalink/)).toMatch(
      /color:\s*var\(--lat-text-subtle\)[\s\S]*transition:\s*color var\(--lat-duration-default\) var\(--lat-easing-out\)/,
    );
    expect(ruleBody(css, /\.doc-section__permalink:focus-visible/)).toMatch(
      /outline:\s*2px solid var\(--lat-focus-ring\)[\s\S]*outline-offset:\s*var\(--lat-space-1\)/,
    );
  });

  it('ties SectionNav roles to their Lattice surface, type, spacing, active, focus, and motion tokens', () => {
    const css = sectionNavCss();
    const desktop = fromMedia(css, 'min-width: 64rem');

    expect(ruleBody(css, /\.section-nav/)).toMatch(/display:\s*none/);
    expect(ruleBody(desktop, /\.section-nav/)).toMatch(
      /top:\s*var\(--lat-space-24\)[\s\S]*padding:\s*var\(--lat-space-5\)[\s\S]*border:\s*1px solid var\(--lat-border\)[\s\S]*border-radius:\s*var\(--lat-radius-sm\)[\s\S]*background:\s*var\(--lat-bg-raised\)/,
    );
    expect(ruleBody(desktop, /\.section-nav__label/)).toMatch(
      /color:\s*var\(--lat-text\)[\s\S]*font-family:\s*var\(--lat-text-meta-font-family\)/,
    );
    expect(ruleBody(desktop, /\.section-nav__link/)).toMatch(
      /color:\s*var\(--lat-text-subtle\)[\s\S]*font-family:\s*var\(--lat-text-meta-font-family\)[\s\S]*transition:[\s\S]*var\(--lat-duration-default\) var\(--lat-easing-out\)/,
    );
    expect(ruleBody(desktop, /\.section-nav__link\[aria-current\]/)).toMatch(
      /border-inline-start-color:\s*var\(--lat-accent-solid\)[\s\S]*background:\s*var\(--lat-bg\)[\s\S]*color:\s*var\(--lat-text\)/,
    );
    expect(ruleBody(desktop, /\.section-nav__link:focus-visible/)).toMatch(/outline-offset:\s*var\(--lat-space-1\)/);
  });

  it('uses the proof-sheet container and desktop rail without letting either grid descendant widen the page', () => {
    const css = pageCss();

    expect(css).toMatch(/grid-template-columns:\s*max-content minmax\(0,\s*var\(--lat-container-prose\)\)/);
    expect(ruleBody(css, /\.score-formula__layout/)).toMatch(/min-inline-size:\s*0/);
    expect(ruleBody(css, /\.score-formula__content/)).toMatch(/min-inline-size:\s*0/);
    expect(ruleBody(css, /\.score-formula__formula-line/)).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('hides the contents rail on narrow screens and makes it sticky only at desktop width', () => {
    const css = sectionNavCss();
    const desktop = fromMedia(css, 'min-width: 64rem');

    expect(ruleBody(css, /\.section-nav/)).toMatch(/display:\s*none/);
    expect(ruleBody(desktop, /\.section-nav/)).toMatch(
      /position:\s*sticky[\s\S]*top:\s*var\(--lat-space-24\)[\s\S]*display:\s*block/,
    );
  });

  it('allows horizontal overflow only on the named table-region class', () => {
    const css = pageCss();
    const horizontalOverflow = [...css.matchAll(/\boverflow(?:-x|-inline)?\s*:\s*[^;]+;/g)].map(([value]) =>
      value.replace(/\s+/g, ' '),
    );

    expect(ruleBody(css, /\.score-formula__table-scroll/)).toMatch(/overflow-x:\s*auto/);
    expect(horizontalOverflow).toEqual(['overflow-x: auto;']);
  });

  it('restores visible list markers after the global list reset', () => {
    const css = pageCss();

    expect(ruleBody(css, /\.score-formula__list > li/)).toMatch(/list-style:\s*disc/);
    expect(ruleBody(css, /\.score-formula__list li::marker/)).toMatch(/color:\s*var\(--lat-text-accent\)/);
  });

  it('removes every decorative transition under reduced motion and defines no page animation', () => {
    const page = pageCss();
    const docSection = docSectionCss();
    const sectionNav = sectionNavCss();
    const reducedPage = fromMedia(page, 'prefers-reduced-motion: reduce');
    const reducedNav = fromMedia(sectionNav, 'prefers-reduced-motion: reduce');

    expect(ruleBody(page, /\.score-formula__back-link/)).toMatch(/transition:/);
    expect(ruleBody(page, /\.score-formula \.docs-prose a/)).toMatch(/transition:/);
    expect(ruleBody(docSection, /\.doc-section__permalink/)).toMatch(/transition:/);
    expect(ruleBody(sectionNav, /\.section-nav__link/)).toMatch(/transition:/);

    expect(
      ruleBody(
        reducedPage,
        /\.score-formula__back-link\s*,\s*\.score-formula \.docs-prose a\s*,\s*\.score-formula \.doc-section__permalink/,
      ),
    ).toMatch(/transition:\s*none/);
    expect(ruleBody(reducedNav, /\.section-nav__link/)).toMatch(/transition:\s*none/);
    expect(page).not.toMatch(/(?:\banimation(?:-[a-z-]+)?\s*:|@keyframes\b)/);
  });
});
