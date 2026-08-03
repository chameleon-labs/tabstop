import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, vi } from 'vitest'

/**
 * The messages React and React Router emit when an error boundary CATCHES an
 * error - which several specs cause on purpose, because catching is the
 * behaviour under test.
 *
 * Three calls per catch, each carrying a full stack: the error object itself,
 * React's "the above error occurred in", and React Router's own line. Nine
 * deliberate throws produced 350 lines of stderr in CI, and the reason that
 * matters is not tidiness - it is that a real warning is invisible inside it.
 * An `act()` warning was sitting in that output for exactly as long as the
 * output existed.
 */
const CAUGHT_BY_BOUNDARY = [
  /The above error occurred in the/,
  /React Router caught the following error during render/
]

/**
 * Matched against the WHOLE call, not its first argument.
 *
 * React 19 logs one `console.error('%o\n\n%s\n\n%s', error, message, message)`,
 * so neither the error nor the sentence is the first argument - the format
 * string is. Anchoring on the first argument matched nothing at all, and the
 * only reason that was visible is that this gate then failed every test it was
 * supposed to let through.
 */
const isCaughtByBoundary = (args: unknown[]): boolean => {
  const call = args.map((arg) => String(arg)).join(' ')
  return CAUGHT_BY_BOUNDARY.some((known) => known.test(call))
}

/**
 * Anything else reaching `console.error` FAILS the test that produced it.
 *
 * This is the half that makes the filtering above safe. Dropping known noise
 * on its own would hide the next `act()` warning just as effectively as the
 * noise did; dropping it and failing on everything else means the log stays
 * empty AND cannot quietly refill. A new warning is a red test naming the spec
 * that caused it, rather than a line nobody reads.
 */
let unexpected: string[] = []

/**
 * `warn` as well as `error`, because the two are one stream in a CI log and a
 * warning is exactly as easy to stop reading. React Router's missing
 * `HydrateFallback` notice arrived this way and was invisible for the same
 * reason the `act()` warning was.
 */
const GATED: Array<'error' | 'warn'> = ['error', 'warn']

beforeEach(() => {
  unexpected = []
  for (const level of GATED) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      if (isCaughtByBoundary(args)) return
      unexpected.push(`console.${level}: ${args.map((arg) => String(arg)).join(' ')}`)
    })
  }
})

// Registered before the assertion below so it runs after it - vitest unwinds
// `afterEach` hooks in reverse. Unmounting can log, and this has to see it.
afterEach(() => { cleanup() })

afterEach(() => {
  const seen = unexpected
  unexpected = []
  for (const level of GATED) vi.mocked(console[level]).mockRestore()
  expect(seen, 'unexpected console output').toEqual([])
})
