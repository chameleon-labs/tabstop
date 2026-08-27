// @vitest-environment node
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {readdir} from 'node:fs/promises';
import {dirname, extname, join, relative} from 'node:path';
import {describe, expect, it} from 'vitest';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
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

describe('the component folder convention', () => {
  it('finds the components, so the rules below are not vacuous', async () => {
    const folders = await componentFolders();

    expect(folders.length).toBeGreaterThanOrEqual(12);
    expect(folders).toContain('screens/components/Layout');
    expect(folders).toContain('screens/modules/audit/pages/Home');
  });

  it('names every component folder in PascalCase', async () => {
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
    const tracked = execFileSync('git', ['ls-files', 'src/screens'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line !== '');

    expect(tracked.length).toBeGreaterThan(0);

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
