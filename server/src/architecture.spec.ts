import {readdir, readFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));

const IMPORT_PATTERNS = [
  /(?:^|\n)\s*(?:import|export)\s+[\w\s{},*]*?from\s+['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*[,)]/g,
];

const specifiersIn = (source: string): string[] =>
  IMPORT_PATTERNS.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1] ?? ''));

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(join(SRC, directory), {recursive: true, withFileTypes: true});
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => relative(SRC, join(entry.parentPath, entry.name)))
    .filter((path) => !path.endsWith('.spec.ts') && !path.endsWith('.test.ts'))
    .filter((path) => !path.split('/').includes('test'));
};

const importsOf = async (path: string): Promise<string[]> => specifiersIn(await readFile(join(SRC, path), 'utf8'));

const offendingImports = async (directory: string, isAllowed: (specifier: string) => boolean): Promise<string[]> => {
  const offences: string[] = [];
  for (const path of await sourceFiles(directory)) {
    for (const specifier of await importsOf(path)) {
      if (!isAllowed(specifier)) {
        offences.push(`${path} -> ${specifier}`);
      }
    }
  }
  return offences.toSorted();
};

const isRelative = (specifier: string): boolean => specifier.startsWith('.');

const forbids = (...layers: string[]) => {
  const pattern = new RegExp(`(^|/)(${layers.join('|')})/`);
  return (specifier: string): boolean => !pattern.test(specifier);
};

const vendorRoot = (specifier: string): string =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : (specifier.split('/')[0] ?? specifier);

describe('the import scanner the rules rest on', () => {
  const specifiers = specifiersIn;

  it('reads an import clause written across several lines', () => {
    expect(
      specifiers(
        [
          'import type {',
          '  DeleteQueuedAuditRepository',
          "} from '../protocols/db/audit/delete-queued-audit-repository.js'",
        ].join('\n'),
      ),
    ).toEqual(['../protocols/db/audit/delete-queued-audit-repository.js']);
  });

  it('reads the single-line forms too', () => {
    expect(
      specifiers(
        [
          "import { Queue } from 'bullmq'",
          "import type { Database } from './database.js'",
          "import * as migration from './001-initial-schema.js'",
          "export { toAuditModel } from './audit-mapper.js'",
        ].join('\n'),
      ),
    ).toEqual(['bullmq', './database.js', './001-initial-schema.js', './audit-mapper.js']);
  });

  it('reads a side-effect import, which has no clause to find', () => {
    expect(specifiers("import '../infra/db/postgres/database.js'")).toEqual(['../infra/db/postgres/database.js']);
  });

  it('reads a dynamic import, wherever in the file it appears', () => {
    expect(
      specifiers(
        [
          'export const load = async (): Promise<void> => {',
          "  const { makeDatabase } = await import('../../infra/db/postgres/helpers/x.js')",
          '}',
        ].join('\n'),
      ),
    ).toEqual(['../../infra/db/postgres/helpers/x.js']);
  });

  it('reads a dynamic import that carries attributes', () => {
    expect(specifiers("const config = await import('../../infra/config.json', { with: { type: 'json' } })")).toEqual([
      '../../infra/config.json',
    ]);
  });

  it('does not mistake a word ending in import for one', () => {
    expect(specifiers('const reimport = (x: string) => x')).toEqual([]);
  });

  it('does not run out of a declaration and across code to a later import', () => {
    expect(
      specifiers(
        [
          'export const forbids = (...layers: string[]) => {',
          '  return (specifier: string): boolean => !pattern.test(specifier)',
          '}',
          '',
          "import { Worker } from 'bullmq'",
        ].join('\n'),
      ),
    ).toEqual(['bullmq']);
  });
});

describe('layer dependencies', () => {
  it('keeps domain/ free of every import that is not domain', async () => {
    expect(await offendingImports('domain', isRelative)).toEqual([]);
  });

  it('keeps data/ free of frameworks, drivers and the runtime', async () => {
    expect(await offendingImports('data', isRelative)).toEqual([]);
  });

  it('keeps data/protocols free of imports that are not domain models', async () => {
    expect(await offendingImports('data/protocols', isRelative)).toEqual([]);
  });

  it('never lets domain/ or data/ reach into a layer above them', async () => {
    expect(await offendingImports('domain', forbids('data', 'presentation', 'infra', 'main'))).toEqual([]);
    expect(await offendingImports('data', forbids('presentation', 'infra', 'main'))).toEqual([]);
  });

  it('holds that rule for the SPECS in domain/ and data/ as well', async () => {
    const outward = (specifier: string): boolean => !/(^|\/)(presentation|infra|main)\//.test(specifier);

    const specs = async (directory: string): Promise<string[]> => {
      const entries = await readdir(join(SRC, directory), {
        recursive: true,
        withFileTypes: true,
      });
      return entries
        .filter((entry) => entry.isFile() && /\.(spec|test)\.ts$/.test(entry.name))
        .map((entry) => relative(SRC, join(entry.parentPath, entry.name)));
    };

    const offences: string[] = [];
    for (const directory of ['domain', 'data']) {
      for (const path of await specs(directory)) {
        for (const specifier of await importsOf(path)) {
          if (!outward(specifier)) {
            offences.push(`${path} -> ${specifier}`);
          }
        }
      }
    }

    expect(offences.toSorted()).toEqual([]);
  });

  it('keeps presentation/ off data/, infra/ and main/', async () => {
    expect(await offendingImports('presentation', forbids('data', 'infra', 'main'))).toEqual([]);
  });

  it('names the published wire contract only where a response is shaped', async () => {
    const importers: string[] = [];

    for (const directory of ['presentation', 'infra', 'main']) {
      for (const path of await sourceFiles(directory)) {
        const specifiers = await importsOf(path);
        if (specifiers.some((specifier) => vendorRoot(specifier) === '@tabstop/contract')) {
          importers.push(path);
        }
      }
    }

    expect(importers.toSorted()).toEqual([
      'presentation/helpers/account-view.ts',
      'presentation/helpers/audit-view.ts',
      'presentation/helpers/http/http-helper.ts',
      'presentation/helpers/page-audit-conflict-view.ts',
      'presentation/helpers/page-conflict-view.ts',
      'presentation/helpers/page-view.ts',
      'presentation/helpers/rate-limit-view.ts',
    ]);
  });

  it('confines playwright, kysely, pg, bullmq, express and zod to their adapters', async () => {
    const vendors = new Set(['playwright', 'kysely', 'pg', 'bullmq', 'express', 'zod']);
    const found = new Map<string, string[]>();

    for (const directory of ['domain', 'data', 'presentation', 'infra']) {
      for (const path of await sourceFiles(directory)) {
        for (const specifier of await importsOf(path)) {
          const vendor = vendorRoot(specifier);
          if (!vendors.has(vendor)) {
            continue;
          }
          const paths = found.get(vendor) ?? [];
          if (!paths.includes(path)) {
            found.set(vendor, [...paths, path]);
          }
        }
      }
    }

    expect(Object.fromEntries([...found].map(([vendor, paths]) => [vendor, paths.toSorted()]))).toEqual({
      playwright: ['infra/audit/playwright-axe-auditor.ts'],
      kysely: [
        'infra/db/postgres/account/account-mapper.ts',
        'infra/db/postgres/account/postgres-account-repository.ts',
        'infra/db/postgres/alert-event/postgres-alert-event-repository.ts',
        'infra/db/postgres/audit/audit-mapper.ts',
        'infra/db/postgres/audit/postgres-audit-repository.ts',
        'infra/db/postgres/database.ts',
        'infra/db/postgres/health/postgres-health-adapter.ts',
        'infra/db/postgres/helpers/postgres-helper.ts',
        'infra/db/postgres/migrations/001-initial-schema.ts',
        'infra/db/postgres/migrations/002-accounts.ts',
        'infra/db/postgres/migrations/003-audit-settled.ts',
        'infra/db/postgres/migrations/004-violation-impact-nullable.ts',
        'infra/db/postgres/migrations/005-audit-claimed-at.ts',
        'infra/db/postgres/migrations/006-sessions-expires-at-index.ts',
        'infra/db/postgres/migrations/007-scheduled-reaudits.ts',
        'infra/db/postgres/migrations/008-alert-delivery.ts',
        'infra/db/postgres/migrations/009-alert-delivery-state.ts',
        'infra/db/postgres/migrations/010-on-demand-audits.ts',
        'infra/db/postgres/migrations/index.ts',
        'infra/db/postgres/migrations/migrator.ts',
        'infra/db/postgres/page/page-mapper.ts',
        'infra/db/postgres/page/postgres-page-repository.ts',
        'infra/db/postgres/session/postgres-session-repository.ts',
        'infra/db/postgres/session/session-mapper.ts',
        'infra/db/postgres/violation/postgres-violation-repository.ts',
        'infra/db/postgres/violation/violation-mapper.ts',
      ],
      pg: ['infra/db/postgres/helpers/postgres-helper.ts'],
      bullmq: ['infra/queue/helpers/bullmq-helper.ts'],
      zod: ['infra/validation/zod-validation-adapter.ts'],
    });
  });
});
