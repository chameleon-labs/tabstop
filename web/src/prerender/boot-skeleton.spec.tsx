import {renderToStaticMarkup} from 'react-dom/server';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {describe, expect, it} from 'vitest';
import {RouteSkeleton} from '@/screens/components/RouteSkeleton';
import {SKELETON_SHAPES, skeletonShapeFor, type SkeletonShape} from '@/screens/components/RouteSkeleton/shapes';
import {bootShapeScript, bootSkeletonMarkup, bootTokenCss, ruleFor, tokensReadBy} from './boot-skeleton';

const LATTICE = `
:root {
  --lat-space-6: 1.5rem;
  --lat-radius-full: 9999rem;
  --lat-gray-text: oklch(0.15 0 0);
}
:root,
[data-lat-theme='light'] {
  --lat-text: var(--lat-gray-text);
}
[data-lat-theme='dark'] {
  --lat-gray-text: oklch(0.91 0 0);
  --lat-text: var(--lat-gray-text);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-lat-theme='light']) {
    --lat-gray-text: oklch(0.91 0 0);
    --lat-text: var(--lat-gray-text);
  }
}
`;

const runScriptFor = (pathname: string): string => {
  // oxlint-disable-next-line no-new-func -- the point is to run the emitted source
  const shape = new Function('pathname', `${bootShapeScript()}\nreturn __bootShape(pathname);`) as (
    p: string,
  ) => string;
  return shape(pathname);
};

describe('tokensReadBy', () => {
  it('finds every --lat-* a sheet reads through var()', () => {
    expect(tokensReadBy('a{gap:var(--lat-space-6);color:var(--lat-text)}')).toEqual(['--lat-space-6', '--lat-text']);
  });

  it('ignores the ones a sheet declares for itself', () => {
    expect(tokensReadBy('a{--lat-mine:1px;gap:var(--lat-space-6)}')).toEqual(['--lat-space-6']);
  });
});

describe('bootTokenCss', () => {
  it('carries the value of every token the skeleton reads', () => {
    const css = bootTokenCss(LATTICE, ['--lat-space-6', '--lat-radius-full']);

    expect(css).toContain('--lat-space-6: 1.5rem');
    expect(css).toContain('--lat-radius-full: 9999rem');
  });

  it('follows a token that is defined as another token, so no var() is left dangling', () => {
    const css = bootTokenCss(LATTICE, ['--lat-text']);

    expect(css).toContain('--lat-text: oklch(0.15 0 0)');
    expect(css).not.toMatch(/--lat-text:\s*var\(/);
  });

  it('carries the dark value too, in both the stamped and the system form', () => {
    const css = bootTokenCss(LATTICE, ['--lat-text']);

    expect(css).toContain("[data-lat-theme='dark']");
    expect(css).toContain('prefers-color-scheme: dark');
    expect(css.match(/oklch\(0\.91 0 0\)/g)).toHaveLength(2);
  });

  it('refuses a token the design system does not define', () => {
    expect(() => bootTokenCss(LATTICE, ['--lat-invented'])).toThrow(/--lat-invented/);
  });
});

describe('bootShapeScript', () => {
  it.each([...SKELETON_SHAPES.map(([, shape]) => shape), 'generic' as SkeletonShape])(
    'agrees with skeletonShapeFor about the %s shape',
    (shape) => {
      const paths = [
        '/dashboard',
        '/pages/42',
        '/login',
        '/signup',
        '/r/abc',
        '/',
        '/dashboard/',
        '/DASHBOARD',
        '/Login',
      ];
      const mine = paths.filter((path) => skeletonShapeFor(path) === shape);

      expect(mine.length).toBeGreaterThan(0);
      for (const path of mine) {
        expect(runScriptFor(path)).toBe(shape);
      }
    },
  );

  it('carries the pattern flags into the table it emits, so the boot shape matches like the router', () => {
    // The table is serialised with String(pattern). Dropping the flags there
    // would leave the two halves of this agreeing with each other and both
    // disagreeing with React Router, which matches without regard to case.
    expect(runScriptFor('/DASHBOARD')).toBe('dashboard');
    expect(runScriptFor('/SignUp')).toBe('form');
  });
});

describe('bootSkeletonMarkup', () => {
  it.each(['dashboard', 'detail', 'form', 'generic'] as const)(
    'renders the same DOM React renders for the %s shape',
    (shape) => {
      const path = {dashboard: '/dashboard', detail: '/pages/42', form: '/login', generic: '/r/abc'}[shape];
      const react = renderToStaticMarkup(
        <RouterProvider
          router={createMemoryRouter([{path: '*', element: <RouteSkeleton />}], {initialEntries: [path]})}
        />,
      );

      expect(bootSkeletonMarkup(shape)).toBe(react);
    },
  );
});

describe('ruleFor', () => {
  it('lifts a rule out of a sheet so it can be inlined without copying it', () => {
    expect(ruleFor('a{x:1}\n.visually-hidden {\n  width: 1px;\n}\nb{y:2}', '.visually-hidden')).toBe(
      '.visually-hidden{\n  width: 1px;\n}',
    );
  });

  it('finds a rule the sheet opens a comment above, which is what the real sheet does', () => {
    // `styles.css` starts with a block comment whose lines begin with `*`, and
    // it mentions a `{`. A lookup that takes the first `*` and then the first
    // `{` after it lifts the comment's brace and inlines the wrong block.
    const sheet = [
      '/*',
      ' * The shell only. The `:root {` overrides sit below.',
      ' */',
      '* {\n  box-sizing: border-box;\n}',
    ].join('\n');

    expect(ruleFor(sheet, '*')).toBe('*{\n  box-sizing: border-box;\n}');
  });

  it('throws when the rule it was told to inline is gone', () => {
    expect(() => ruleFor('a{x:1}', '.visually-hidden')).toThrow(/visually-hidden/);
  });
});
