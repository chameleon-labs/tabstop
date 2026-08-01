import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('.', import.meta.url))

/**
 * The ways a file names a dependency, matched by hand.
 *
 * By hand because the alternative is not available: TypeScript 7 is the
 * native port and exposes no `createSourceFile`, so there is no AST to walk
 * without adding a second parser. That makes this an enumeration, and an
 * enumeration is only ever as good as the list - which has now been wrong
 * three times, each time in a form nobody was writing until somebody did:
 *
 * 1. A clause with `from`, on one line or several. Matching `[^\n;]*?` between
 *    `import` and `from` saw only the single-line form - and this codebase
 *    wraps constantly, because a protocol name plus a four-deep relative path
 *    does not fit the line limit. 109 of 967 specifiers were invisible.
 * 2. A side-effect import, `import './x.js'`, which has no clause at all.
 * 3. A dynamic `import('./x.js')`, which is not a statement and can appear
 *    anywhere in a file - including with a second argument, since
 *    `import('./x.json', { with: { type: 'json' } })` is the attributes form.
 *
 * So this claims coverage of those forms and no more. Each carries the same
 * coupling - a domain module doing any of them has taken on a dependency - so
 * a form left out is a way to bypass every rule below by writing an import
 * differently. Nothing does that today; the point of this file is that nothing
 * can, and the point of this comment is that "nothing can" rests on a list.
 *
 * The character class in the first pattern is what keeps a newline-tolerant
 * match honest. An import clause holds identifiers, braces, commas, `*`, `as`
 * and `type` and nothing else, so a non-greedy match cannot run out of an
 * `export const` and across arbitrary code to find some later `from` - which
 * `[\s\S]*?` would do in a file with no semicolons to stop it.
 */
const IMPORT_PATTERNS = [
  /(?:^|\n)\s*(?:import|export)\s+[\w\s{},*]*?from\s+['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
  // `[,)]` rather than `)`: the specifier can be followed by import
  // attributes, and requiring the call to close straight after it missed
  // every dynamic import that carries them.
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*[,)]/g
]

const specifiersIn = (source: string): string[] =>
  IMPORT_PATTERNS.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1] ?? '')
  )

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

const importsOf = async (path: string): Promise<string[]> =>
  specifiersIn(await readFile(join(SRC, path), 'utf8'))

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

/** Rejects an import that lands in any of the named layers. */
const forbids = (...layers: string[]) => {
  const pattern = new RegExp(`(^|/)(${layers.join('|')})/`)
  return (specifier: string): boolean => !pattern.test(specifier)
}

/**
 * The installed package a specifier resolves to, so a subpath counts as the
 * package it comes from. Matching the bare name alone missed
 * `kysely/migration`, which two migration files import - and one of them,
 * migrations/index.ts, imports kysely by no other route, so it was absent
 * from the pinned list entirely while the assertion still passed.
 */
const vendorRoot = (specifier: string): string =>
  specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : (specifier.split('/')[0] ?? specifier)

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
describe('the import scanner the rules rest on', () => {
  const specifiers = specifiersIn

  it('reads an import clause written across several lines', () => {
    // 109 of this codebase's 967 import specifiers are written this way,
    // because a protocol name plus a four-deep relative path does not fit the
    // line limit. Every one of them was invisible to the rules below until
    // this pattern stopped matching `[^\n;]`.
    expect(specifiers([
      'import type {',
      '  DeleteQueuedAuditRepository',
      '} from \'../protocols/db/audit/delete-queued-audit-repository.js\''
    ].join('\n'))).toEqual(['../protocols/db/audit/delete-queued-audit-repository.js'])
  })

  it('reads the single-line forms too', () => {
    expect(specifiers([
      'import { Queue } from \'bullmq\'',
      'import type { Database } from \'./database.js\'',
      'import * as migration from \'./001-initial-schema.js\'',
      'export { toAuditModel } from \'./audit-mapper.js\''
    ].join('\n'))).toEqual(['bullmq', './database.js', './001-initial-schema.js', './audit-mapper.js'])
  })

  it('reads a side-effect import, which has no clause to find', () => {
    // `import './register.js'` names a dependency as surely as any other form,
    // and it is the one a module reaches for precisely when it wants the
    // side effect rather than a value - which is exactly the coupling these
    // rules exist to catch.
    expect(specifiers('import \'../infra/db/postgres/database.js\''))
      .toEqual(['../infra/db/postgres/database.js'])
  })

  it('reads a dynamic import, wherever in the file it appears', () => {
    // Not a statement, so it can sit inside a function body halfway down a
    // file - and a `data/` usecase that lazily imported a driver this way
    // would have satisfied every rule below.
    expect(specifiers([
      'export const load = async (): Promise<void> => {',
      '  const { makeDatabase } = await import(\'../../infra/db/postgres/helpers/x.js\')',
      '}'
    ].join('\n'))).toEqual(['../../infra/db/postgres/helpers/x.js'])
  })

  it('reads a dynamic import that carries attributes', () => {
    // `import(specifier, options)` is as valid as the one-argument form, so a
    // pattern demanding `)` straight after the specifier reads a whole valid
    // syntax as absent - and a `data/` module could import a driver this way
    // while satisfying every rule below.
    expect(specifiers(
      'const config = await import(\'../../infra/config.json\', { with: { type: \'json\' } })'
    )).toEqual(['../../infra/config.json'])
  })

  it('does not mistake a word ending in import for one', () => {
    expect(specifiers('const reimport = (x: string) => x')).toEqual([])
  })

  it('does not run out of a declaration and across code to a later import', () => {
    // The hazard of letting the match cross newlines. This codebase writes no
    // semicolons, so nothing but the character class stops `[\s\S]*?` running
    // from `export const` to whatever `from '...'` appears next - which would
    // attribute an import to a file at a position where there is none.
    expect(specifiers([
      'export const forbids = (...layers: string[]) => {',
      '  return (specifier: string): boolean => !pattern.test(specifier)',
      '}',
      '',
      'import { Worker } from \'bullmq\''
    ].join('\n'))).toEqual(['bullmq'])
  })
})

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

  it('never lets domain/ or data/ reach into a layer above them', async () => {
    // A predicate PER LAYER, not one shared between them, because the two do
    // not have the same neighbours: data/ may name domain/, and domain/ may
    // name nothing. Sharing one list quietly dropped `data` from domain's -
    // so `domain/services/x.ts` importing '../../data/usecases/y.js' was
    // relative, was not presentation/infra/main, and passed both assertions.
    // Nothing does that today; the point of this file is that nothing can.
    expect(await offendingImports('domain', forbids('data', 'presentation', 'infra', 'main')))
      .toEqual([])
    expect(await offendingImports('data', forbids('presentation', 'infra', 'main')))
      .toEqual([])
  })

  it('holds that rule for the SPECS in domain/ and data/ as well', async () => {
    // Separate from the rule above because it covers a different file set, and
    // because the exemption the others make for specs does not belong here.
    //
    // Importing vitest in a spec is unavoidable. Importing a driver is not: a
    // unit spec that reaches for infra/ is either testing something other than
    // the unit - in which case it is an integration spec and belongs in main/,
    // where composition lives - or it is using a concrete where the usecase
    // takes a port, which is exactly the coupling these layers exist to
    // prevent. Both were present: db-request-audit.spec.ts pulled in the real
    // url policy instead of stubbing the port it is handed, and a 257-line
    // end-to-end spec driving real Chromium and real Postgres sat inside
    // data/usecases/run-audit/.
    const outward = (specifier: string): boolean =>
      !/(^|\/)(presentation|infra|main)\//.test(specifier)

    const specs = async (directory: string): Promise<string[]> => {
      const entries = await readdir(join(SRC, directory), {
        recursive: true, withFileTypes: true
      })
      return entries
        .filter((entry) => entry.isFile() && /\.(spec|test)\.ts$/.test(entry.name))
        .map((entry) => relative(SRC, join(entry.parentPath, entry.name)))
    }

    const offences: string[] = []
    for (const directory of ['domain', 'data']) {
      for (const path of await specs(directory)) {
        for (const specifier of await importsOf(path)) {
          if (!outward(specifier)) offences.push(`${path} -> ${specifier}`)
        }
      }
    }

    expect(offences.sort()).toEqual([])
  })

  it('keeps presentation/ off data/, infra/ and main/', async () => {
    // Controllers depend on domain USECASES - the interfaces - and on their
    // own protocols. main/ is what hands them a concrete.
    //
    // `data` belongs in this list even though the comment above never said so:
    // a controller importing DbAuthenticate rather than the Authenticate it is
    // constructed with is the same mistake as importing a driver, just one
    // layer shallower, and the assertion was not catching it.
    expect(await offendingImports('presentation', forbids('data', 'infra', 'main')))
      .toEqual([])
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
          // Resolved to the package, so `kysely/migration` counts as kysely.
          const vendor = vendorRoot(specifier)
          if (!vendors.includes(vendor)) continue
          const paths = found.get(vendor) ?? []
          // A file importing both `kysely` and `kysely/migration` is one file.
          if (!paths.includes(path)) found.set(vendor, [...paths, path])
        }
      }
    }

    expect(Object.fromEntries([...found].map(([vendor, paths]) => [vendor, paths.sort()])))
      .toEqual({
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
          // Reached only through `kysely/migration`, so the exact-name match
          // never saw it.
          'infra/db/postgres/migrations/index.ts',
          'infra/db/postgres/migrations/migrator.ts',
          'infra/db/postgres/page/page-mapper.ts',
          'infra/db/postgres/page/postgres-page-repository.ts',
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
