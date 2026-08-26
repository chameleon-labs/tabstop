// @vitest-environment node
//
// This one reads the filesystem and shells out to git; jsdom gives it nothing
// it needs and takes `import.meta.url` away, serving it over http so
// `fileURLToPath` throws before a single test is collected.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {readdir} from 'node:fs/promises';
import {dirname, extname, join, relative} from 'node:path';
import {describe, expect, it} from 'vitest';

/** Vitest runs with the package root as cwd, which is what `vite.config.ts` resolves against too. */
const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
/**
 * Where component folders live, discovered rather than listed.
 *
 * Modules are added by creating a directory, and a hard-coded list would go
 * quietly out of date the first time one appeared - which is the failure this
 * whole file exists to prevent, so it must not be the way this file works.
 */
const componentRoots = async (): Promise<string[]> => {
  const modules = await foldersIn('screens/modules');
  return ['screens/components', ...modules.flatMap((module) => [`${module}/components`, `${module}/pages`])];
};

const foldersIn = async (root: string): Promise<string[]> => {
  const entries = await readdir(join(SRC, root), {withFileTypes: true});
  return entries.filter((entry) => entry.isDirectory()).map((entry) => `${root}/${entry.name}`);
};

const filesIn = async (folder: string): Promise<string[]> => {
  const entries = await readdir(join(SRC, folder), {withFileTypes: true});
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
};

const componentFolders = async (): Promise<string[]> =>
  (await Promise.all((await componentRoots()).map(foldersIn))).flat().toSorted();

/**
 * The layout rules, enforced instead of remembered.
 *
 * Every one of these is the kind of thing that holds by convention right up
 * until it doesn't, and the cost of noticing late is a rename across every
 * importer. They are cheap - three directory reads - so the boundary is a fact
 * rather than a habit.
 */
describe('the component folder convention', () => {
  it('finds the components, so the rules below are not vacuous', async () => {
    // Without this, a bad glob or a moved directory turns every assertion here
    // into a loop over nothing that passes triumphantly.
    // A count alone passes against the wrong tree, so this names two folders
    // that must be found: one shared, one inside a module.
    const folders = await componentFolders();

    expect(folders.length).toBeGreaterThanOrEqual(12);
    expect(folders).toContain('screens/components/Layout');
    expect(folders).toContain('screens/modules/audit/pages/Home');
  });

  it('names every component folder in PascalCase', async () => {
    // The folder itself is PascalCase; everything containing it is lowercase.
    const offenders = (await componentFolders()).filter((folder) => !/^[a-z][a-z/]*\/[A-Z][A-Za-z0-9]*$/.test(folder));

    expect(offenders).toEqual([]);
  });

  it('gives every component an index and a test beside it', async () => {
    const offenders: string[] = [];

    for (const folder of await componentFolders()) {
      const files = await filesIn(folder);
      if (!files.includes('index.tsx')) {
        offenders.push(`${folder}: no index.tsx`);
      }
      if (!files.includes('index.spec.tsx')) {
        offenders.push(`${folder}: no index.spec.tsx`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('records that casing in git, not only on this filesystem', async () => {
    // macOS is case-insensitive and git's `core.ignorecase` follows it, so
    // renaming `home/` to `Home/` can leave the index still holding `home/`.
    // Everything passes locally and the Linux CI runner then cannot resolve
    // `./screens/Home` at all. This happened once already, on this commit.
    const tracked = execFileSync('git', ['ls-files', 'src/screens'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line !== '');

    expect(tracked.length).toBeGreaterThan(0);

    /**
     * Every tracked path that matches a component folder case-INSENSITIVELY has
     * to match it exactly.
     *
     * Asking only whether some tracked file sits under the right casing is not
     * enough, and the gap is the very case this exists for: git holding both
     * `Layout/index.spec.tsx` and a stale `layout/index.tsx` satisfies that
     * question while being two directories on Linux. So the comparison is made
     * against every candidate, not the first one that agrees.
     *
     * A folder with nothing tracked is also an offender - it means the move was
     * never staged, and the tree on disk is telling a different story from the
     * one that will be checked out.
     */
    const folders = await componentFolders();
    const offenders = folders.flatMap((folder) => {
      const prefix = `src/${folder}/`;
      const candidates = tracked.filter((path) => path.toLowerCase().startsWith(prefix.toLowerCase()));
      if (candidates.length === 0) {
        return [`${folder}: nothing tracked`];
      }
      return candidates.filter((path) => !path.startsWith(prefix));
    });

    expect(offenders).toEqual([]);
  });
});

/**
 * Every relative import reachable from `vite.config.ts`, and whether it names a file.
 *
 * Vite loads the config with esbuild today and will load it natively - no
 * bundler, no resolver - in a future major. Native ESM has no extension
 * search, so `./paths` is unresolvable there while `./paths.ts` is fine. Vite
 * warns about each one; this turns the warning into a failure.
 *
 * The walk is transitive because the warning is: `vite.config.ts` imports two
 * files, but the rule binds everything they pull in as well.
 */
const configGraph = (): {visited: string[]; extensionless: string[]} => {
  const visited: string[] = [];
  const extensionless: string[] = [];
  const queue = [join(ROOT, 'vite.config.ts')];

  while (queue.length > 0) {
    const file = queue.pop()!;
    const seen = relative(ROOT, file);
    if (visited.includes(seen)) {
      continue;
    }
    visited.push(seen);

    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      if (specifier === undefined || !specifier.startsWith('.')) {
        continue;
      }
      if (extname(specifier) === '') {
        extensionless.push(`${seen}: ${specifier}`);
        continue;
      }
      if (/\.tsx?$/.test(specifier)) {
        queue.push(join(dirname(file), specifier));
      }
    }
  }

  return {visited: visited.toSorted(), extensionless};
};

describe('the vite config module graph', () => {
  it('reaches the files it is meant to police, so the rule below is not vacuous', () => {
    // A regex that matched nothing, or a walk that stopped at the config,
    // would report a clean graph forever. These four are the transitive
    // reach: the config's own two imports, and what those import in turn.
    const {visited} = configGraph();

    expect(visited).toContain('vite.config.ts');
    expect(visited).toContain(join('src', 'prerender', 'inject.ts'));
    expect(visited).toContain(join('src', 'prerender', 'boot-skeleton.ts'));
    expect(visited).toContain(join('src', 'screens', 'components', 'RouteSkeleton', 'shapes.ts'));
  });

  it('names a file in every relative import, so a native config load resolves it', () => {
    const {extensionless} = configGraph();

    expect(extensionless).toEqual([]);
  });
});
