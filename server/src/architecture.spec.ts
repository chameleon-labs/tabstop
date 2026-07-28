import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('.', import.meta.url))

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)\b[^\n;]*?from\s+['"]([^'"]+)['"]/g

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(join(SRC, directory), { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => relative(SRC, join(entry.parentPath, entry.name)))
    // Specs and shared mocks import vitest by necessity. The rule is about
    // what ships, so production sources are what it covers.
    .filter((path) => !path.endsWith('.spec.ts') && !path.endsWith('.test.ts'))
    .filter((path) => !path.split('/').includes('test'))
}

const importsOf = async (path: string): Promise<string[]> => {
  const source = await readFile(join(SRC, path), 'utf8')
  return [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? '')
}

const offendingImports = async (
  directory: string, isAllowed: (specifier: string) => boolean
): Promise<string[]> => {
  const offences: string[] = []
  for (const path of await sourceFiles(directory)) {
    for (const specifier of await importsOf(path)) {
      if (!isAllowed(specifier)) offences.push(`${path} -> ${specifier}`)
    }
  }
  return offences.sort()
}

const isRelative = (specifier: string): boolean => specifier.startsWith('.')

/**
 * The dependency rule, enforced rather than described.
 *
 * Every one of these held by convention alone, which is exactly how the two
 * `node:net` imports got in: `BlockList` is a tempting, correct, well-tested
 * way to compare IP ranges, and nothing objected when it landed in a domain
 * service. Reviewing for it works until the once it doesn't, and by then the
 * layer below has a runtime dependency nobody chose deliberately.
 *
 * These assertions are cheap and total - they read every source file - so the
 * cost of keeping them is a second per run and the benefit is that the
 * boundary is a fact rather than an aspiration.
 */
describe('layer dependencies', () => {
  it('keeps domain/ free of every import that is not domain', async () => {
    // Not even node: builtins. A domain service reaching for the runtime is
    // how a policy stops being testable as pure data - and stops being
    // replaceable, which is the whole reason UrlPolicy exists as a port.
    expect(await offendingImports('domain', isRelative)).toEqual([])
  })

  it('keeps data/ free of frameworks, drivers and the runtime', async () => {
    // data/ orchestrates domain rules through protocols it declares itself, so
    // the only thing it may name is a relative path. Anything else is a
    // concrete detail that belongs behind a protocol, in infra/.
    expect(await offendingImports('data', isRelative)).toEqual([])
  })

  it('keeps data/protocols free of imports that are not domain models', async () => {
    // A protocol is the boundary itself. An external type in one puts the
    // vendor on both sides of it.
    expect(await offendingImports('data/protocols', isRelative)).toEqual([])
  })

  it('never lets domain/ or data/ reach outward into presentation, infra or main', async () => {
    const outward = (specifier: string): boolean =>
      !/(^|\/)(presentation|infra|main)\//.test(specifier)

    expect(await offendingImports('domain', outward)).toEqual([])
    expect(await offendingImports('data', outward)).toEqual([])
  })

  it('keeps presentation/ off infra/ and main/', async () => {
    // Controllers depend on domain usecases and their own protocols. An infra
    // import here is a controller talking to a driver.
    const allowed = (specifier: string): boolean =>
      !/(^|\/)(infra|main)\//.test(specifier)

    expect(await offendingImports('presentation', allowed)).toEqual([])
  })

  it('confines playwright, kysely, pg, bullmq, express and zod to their adapters', async () => {
    // Each of these should exist in exactly one place, so swapping it is a
    // file rather than an excavation. main/ is the composition root and is
    // allowed to name anything it wires.
    const vendors = ['playwright', 'kysely', 'pg', 'bullmq', 'express', 'zod']
    const found = new Map<string, string[]>()

    for (const directory of ['domain', 'data', 'presentation', 'infra']) {
      for (const path of await sourceFiles(directory)) {
        for (const specifier of await importsOf(path)) {
          if (!vendors.includes(specifier)) continue
          found.set(specifier, [...(found.get(specifier) ?? []), path])
        }
      }
    }

    expect(Object.fromEntries([...found].map(([vendor, paths]) => [vendor, paths.sort()])))
      .toEqual({
        playwright: ['infra/audit/playwright-axe-auditor.ts'],
        kysely: [
          'infra/db/postgres/account/account-mapper.ts',
          'infra/db/postgres/account/postgres-account-repository.ts',
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
          'infra/db/postgres/migrations/migrator.ts',
          'infra/db/postgres/session/postgres-session-repository.ts',
          'infra/db/postgres/session/session-mapper.ts',
          'infra/db/postgres/violation/postgres-violation-repository.ts',
          'infra/db/postgres/violation/violation-mapper.ts'
        ],
        pg: ['infra/db/postgres/helpers/postgres-helper.ts'],
        bullmq: ['infra/queue/helpers/bullmq-helper.ts'],
        zod: ['infra/validation/zod-validation-adapter.ts']
      })
  })
})
