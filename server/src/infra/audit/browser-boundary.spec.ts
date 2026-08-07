import {execFile} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {describe, expect, it} from 'vitest';

const run = promisify(execFile);

const SERVER_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TSC = join(SERVER_ROOT, 'node_modules', '.bin', 'tsc');
const BROWSER_DIR = join(SERVER_ROOT, 'src', 'infra', 'audit', 'browser');

/**
 * Compiles one snippet against a copy of a real tsconfig's compilerOptions.
 *
 * A copy rather than the config itself, because the point is to check what a
 * NEW file in that program would be allowed to do - and the only honest way to
 * ask that is to compile a file that does the thing. Reading `lib` out of the
 * JSON and asserting on the string would pass just as happily if the option
 * had stopped taking effect.
 */
const compileUnder = async (configPath: string, source: string): Promise<string> => {
  // Under the server directory rather than the OS temp dir, and that is
  // load-bearing: automatic @types discovery walks up from the tsconfig, so a
  // probe in /tmp finds no node_modules and sees no Node types no matter what
  // the config says. That made the `types: []` assertion below vacuous - it
  // passed just as happily with the option removed.
  const directory = await mkdtemp(join(SERVER_ROOT, '.boundary-probe-'));
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify({type: 'module'}));
    await writeFile(join(directory, 'probe.ts'), source);
    // `extends` resolves the real options, including any future edit to them.
    // Only emit settings and the file list are overridden - notably NOT `lib`
    // or `types`, which are the two this spec exists to check.
    await writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        extends: configPath,
        compilerOptions: {noEmit: true, composite: false, rootDir: '.', outDir: 'out'},
        include: ['probe.ts'],
        references: [],
      }),
    );

    const {stdout} = await run(TSC, ['-p', join(directory, 'tsconfig.json')]).catch((error: {stdout?: string}) => ({
      stdout: error.stdout ?? '',
    }));
    return stdout;
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
};

/**
 * Compiles a probe placed INSIDE the browser project, so the project root -
 * and therefore automatic @types resolution - is the real one.
 */
const compileInBrowserProject = async (source: string): Promise<string> => {
  const probe = join(BROWSER_DIR, '.boundary-probe.ts');
  const config = join(BROWSER_DIR, '.boundary-probe.tsconfig.json');
  try {
    await writeFile(probe, source);
    await writeFile(
      config,
      JSON.stringify({
        extends: './tsconfig.json',
        compilerOptions: {noEmit: true, composite: false, outDir: '.probe-out'},
        include: ['.boundary-probe.ts'],
      }),
    );

    const {stdout} = await run(TSC, ['-p', config]).catch((error: {stdout?: string}) => ({stdout: error.stdout ?? ''}));
    return stdout;
  } finally {
    await rm(probe, {force: true});
    await rm(config, {force: true});
  }
};

const MAIN_CONFIG = join(SERVER_ROOT, 'tsconfig.json');
const BROWSER_CONFIG = join(BROWSER_DIR, 'tsconfig.json');

describe('browser compilation boundary', () => {
  it('compiles the browser unit with DOM types available', async () => {
    // The whole reason the directory exists. If this stops holding, the unit
    // has silently become an ordinary Node file and the casts it was created
    // to remove would have to come back.
    const output = await compileUnder(BROWSER_CONFIG, 'export const title = (): string => document.title\n');

    expect(output).toBe('');
  });

  it('refuses Node globals inside the browser unit', async () => {
    // Compiled from inside the browser project rather than through a copy of
    // its options, so the project root is the real one.
    //
    // Two different mechanisms are easy to conflate here, and only the first
    // matters. AUTOMATIC @types inclusion - what happens with no `types` field
    // - was measured on TypeScript 7.0.2 in this pnpm layout and does not
    // reach `server/node_modules/@types` from a root below it: probes one and
    // two directories down both saw no `process`. EXPLICIT resolution does,
    // which is why `types: ["node"]` from the same root makes this test fail.
    //
    // So `types: []` is belt-and-braces rather than the mechanism: this unit's
    // root has no node_modules of its own, and gets no Node types either way.
    // What the test actually guards is somebody adding them back explicitly.
    //
    // What that would cost: `process.env` typechecking inside a function that
    // page.evaluate serialises into a browser is a compile-time green light
    // for a guaranteed runtime failure.
    const output = await compileInBrowserProject('export const cwd = (): string => process.cwd()\n');

    expect(output).toContain("Cannot find name 'process'");
  });

  it.each(['document', 'window', 'localStorage'])('still refuses %s in the main server program', async (global) => {
    // The hazard the separate unit exists to avoid: adding "DOM" to the
    // server's own lib would make all three compile everywhere in a Node
    // process, and a DOM-flavoured `fetch` with them.
    const output = await compileUnder(MAIN_CONFIG, `export const probe = (): unknown => ${global}\n`);

    expect(output).toContain(`Cannot find name '${global}'`);
  });
});
