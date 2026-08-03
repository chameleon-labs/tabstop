// @vitest-environment node
//
// This one reads the filesystem and shells out to git; jsdom gives it nothing
// it needs and takes `import.meta.url` away, serving it over http so
// `fileURLToPath` throws before a single test is collected.
import { execFileSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Vitest runs with the package root as cwd, which is what `vite.config.ts` resolves against too. */
const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const COMPONENT_ROOTS = ['components', 'screens']

const foldersIn = async (root: string): Promise<string[]> => {
  const entries = await readdir(join(SRC, root), { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => `${root}/${entry.name}`)
}

const filesIn = async (folder: string): Promise<string[]> => {
  const entries = await readdir(join(SRC, folder), { withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
}

const componentFolders = async (): Promise<string[]> =>
  (await Promise.all(COMPONENT_ROOTS.map(foldersIn))).flat().sort()

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
    expect((await componentFolders()).length).toBeGreaterThanOrEqual(9)
  })

  it('names every component folder in PascalCase', async () => {
    const offenders = (await componentFolders())
      .filter((folder) => !/^[a-z]+\/[A-Z][A-Za-z0-9]*$/.test(folder))

    expect(offenders).toEqual([])
  })

  it('gives every component an index and a test beside it', async () => {
    const offenders: string[] = []

    for (const folder of await componentFolders()) {
      const files = await filesIn(folder)
      if (!files.includes('index.tsx')) offenders.push(`${folder}: no index.tsx`)
      if (!files.includes('index.spec.tsx')) offenders.push(`${folder}: no index.spec.tsx`)
    }

    expect(offenders).toEqual([])
  })

  it('records that casing in git, not only on this filesystem', async () => {
    // macOS is case-insensitive and git's `core.ignorecase` follows it, so
    // renaming `home/` to `Home/` can leave the index still holding `home/`.
    // Everything passes locally and the Linux CI runner then cannot resolve
    // `./screens/Home` at all. This happened once already, on this commit.
    const tracked = execFileSync('git', ['ls-files', 'src/components', 'src/screens'], {
      cwd: ROOT, encoding: 'utf8'
    }).split('\n').filter((line) => line !== '')

    expect(tracked.length).toBeGreaterThan(0)

    const offenders = tracked.filter((path) => !/^src\/[a-z]+\/[A-Z][A-Za-z0-9]*\//.test(path))

    expect(offenders).toEqual([])
  })
})
