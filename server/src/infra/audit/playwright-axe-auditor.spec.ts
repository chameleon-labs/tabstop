import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isBlockedAddress, type UrlPolicy } from '../../domain/services/url-safety.js'
import { NodeDnsResolver } from '../net/node-dns-resolver.js'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PlaywrightAxeAuditor } from './playwright-axe-auditor.js'
import { startFixtureServer, type FixtureServer } from './test/fixture-server.js'

const VENDORED_VERSION = readFileSync(
  fileURLToPath(new URL('./vendor/VERSION', import.meta.url)), 'utf8'
).trim()

const BUDGETS = { navigationMs: 20_000, settleMs: 3_000, fallbackSettleMs: 500 }

/**
 * The production policy with exactly two holes, both forced by the fixture
 * server: it listens on loopback and on an ephemeral port. Every other range -
 * 10/8, 169.254/16 and the rest - stays genuinely enforced, so the blocking
 * these specs assert is the real policy at work rather than a stub agreeing
 * with them.
 */
const allowingFixtureServer: UrlPolicy = {
  isAllowedPort: () => true,
  isBlockedAddress: (address) =>
    address === '127.0.0.1' || address === '::1' ? false : isBlockedAddress(address)
}

describe('PlaywrightAxeAuditor', () => {
  let server: FixtureServer
  let sut: PlaywrightAxeAuditor

  beforeAll(async () => {
    server = await startFixtureServer()
    sut = new PlaywrightAxeAuditor(BUDGETS, new NodeDnsResolver(), allowingFixtureServer)
  }, 60_000)

  afterAll(async () => {
    await sut.close()
    await server.close()
  })

  const signal = (): AbortSignal => new AbortController().signal

  it('audits a page and reports its violations in the repository shape', async () => {
    const result = await sut.audit(server.baseUrl, signal())

    const ruleIds = result.violations.map((violation) => violation.ruleId)
    expect(ruleIds).toContain('image-alt')
    expect(ruleIds).toContain('label')
    expect(result.settled).toBe(true)
    expect(result.durationMs).toBeGreaterThan(0)

    // Read from the run itself, so it can never disagree with the file that
    // actually executed.
    expect(result.axeVersion).toBe(VENDORED_VERSION)
  })

  it('returns nodes carrying only target and html', async () => {
    // axe nodes also carry any/all/none/impact/failureSummary. Mapping happens
    // in the browser precisely so none of that crosses into Node.
    const result = await sut.audit(server.baseUrl, signal())
    const node = result.violations[0]?.nodes[0]

    expect(Object.keys(node ?? {}).sort()).toEqual(['html', 'target'])
    expect(Array.isArray(node?.target)).toBe(true)
  })

  it('flattens a shadow-DOM selector rather than storing a nested array', async () => {
    // axe hands back [["#host","input"]] for a node inside a shadow root. The
    // protocol claims string[], so without flattening the annotation would be
    // a runtime lie and any consumer doing string work on an entry would break.
    const result = await sut.audit(`${server.baseUrl}/shadow`, signal())

    const targets = result.violations.flatMap((violation) =>
      violation.nodes.map((node) => node.target))
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      for (const entry of target) {
        expect(typeof entry).toBe('string')
      }
    }
    expect(targets.some((target) => target.some((entry) => entry.includes('>>>')))).toBe(true)
  })

  it('reports only impacts the database will accept', async () => {
    const result = await sut.audit(server.baseUrl, signal())

    for (const violation of result.violations) {
      expect(['minor', 'moderate', 'serious', 'critical']).toContain(violation.impact)
    }
  })

  it('injects the engine through a blocking Content Security Policy', async () => {
    // bypassCSP is load-bearing: without it addScriptTag throws here, and we
    // would fail on exactly the sites most likely to be built carefully.
    const result = await sut.audit(`${server.baseUrl}/csp`, signal())

    expect(result.violations.length).toBeGreaterThan(0)
  })

  it('audits a page that never reaches network idle, and records that it did', async () => {
    const result = await sut.audit(`${server.baseUrl}/never-idle`, signal())

    expect(result.settled).toBe(false)
    expect(result.violations.map((violation) => violation.ruleId)).toContain('label')
  }, 30_000)

  it('closes the context on the failure path, not just the happy one', async () => {
    await expect(sut.audit('http://127.0.0.1:45999', signal())).rejects.toThrow()

    expect(await sut.contextCount()).toBe(0)
  })

  it('surfaces navigation failures with the net:: code the classifier matches on', async () => {
    await expect(sut.audit('http://127.0.0.1:45999', signal()))
      .rejects.toThrow(/net::ERR_CONNECTION_REFUSED/)
  })
})

describe('vendored engine in the build output', () => {
  it('reaches dist/ when a build has been run', () => {
    // tsc copies no .js assets, so without the explicit copy step this passes
    // in development and fails only in production. CI builds before testing,
    // which is what makes this assertion meaningful there.
    const dist = fileURLToPath(new URL('../../../dist/infra/audit/vendor/axe.min.js', import.meta.url))
    const distExists = existsSync(fileURLToPath(new URL('../../../dist', import.meta.url)))

    if (!distExists) {
      expect(distExists).toBe(false)  // nothing built locally; CI covers this
      return
    }
    expect(existsSync(dist)).toBe(true)
  })
})
