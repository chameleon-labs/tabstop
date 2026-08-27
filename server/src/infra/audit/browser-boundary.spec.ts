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

const compileUnder = async (configPath: string, source: string): Promise<string> => {
  const directory = await mkdtemp(join(SERVER_ROOT, '.boundary-probe-'));
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify({type: 'module'}));
    await writeFile(join(directory, 'probe.ts'), source);
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
    const output = await compileUnder(BROWSER_CONFIG, 'export const title = (): string => document.title\n');

    expect(output).toBe('');
  });

  it('refuses Node globals inside the browser unit', async () => {
    const output = await compileInBrowserProject('export const cwd = (): string => process.cwd()\n');

    expect(output).toContain("Cannot find name 'process'");
  });

  it.each(['document', 'window', 'localStorage'])('still refuses %s in the main server program', async (global) => {
    const output = await compileUnder(MAIN_CONFIG, `export const probe = (): unknown => ${global}\n`);

    expect(output).toContain(`Cannot find name '${global}'`);
  });
});
