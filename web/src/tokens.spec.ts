// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {glob} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';

const require = createRequire(import.meta.url);

/** Resolved by `require.resolve`, so a pnpm layout change cannot strand it. */
const declaredTokens = (): Set<string> => {
  const sources = [
    require.resolve('@chameleon-labs/lattice-tokens/lattice.css'),
    require.resolve('@chameleon-labs/lattice-react/styles.css'),
  ].map((path) => readFileSync(path, 'utf8'));

  return new Set(sources.flatMap((css) => [...css.matchAll(/(--lat-[a-z0-9-]+)\s*:/g)].map(([, name]) => name!)));
};

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the design token contract', () => {
  it('resolves every --lat-* this app reads', async () => {
    // An undefined custom property is an error nowhere in the stack.
    // `--lat-space-7` and `--lat-text-muted` both reached review that way.
    const declared = declaredTokens();
    const offenders: string[] = [];

    for await (const file of glob('src/**/*.css')) {
      const css = stripComments(readFileSync(file, 'utf8'));
      // A sheet may define its own, as `styles.css` does for the accent ink.
      const local = new Set([...css.matchAll(/(--lat-[a-z0-9-]+)\s*:/g)].map(([, name]) => name!));

      for (const [, name] of css.matchAll(/var\((--lat-[a-z0-9-]+)/g)) {
        if (!declared.has(name!) && !local.has(name!)) {
          offenders.push(`${file}: ${name!}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('reads a token set worth checking against', () => {
    // A resolve returning an empty file would make the above vacuous.
    expect(declaredTokens().size).toBeGreaterThan(100);
  });
});
