import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Page } from 'playwright'
import type { UrlPolicy } from '../../domain/services/url-safety.js'
import { DEFAULT_URL_POLICY, isBlockedAddress } from '../net/ip-address-policy.js'
import { NodeDnsResolver } from '../net/node-dns-resolver.js'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  AUDIT_CONTEXT_OPTIONS, PlaywrightAxeAuditor, installGuards
} from './playwright-axe-auditor.js'
import { makeRequestGuard } from './request-guard.js'
import { CoalescingDnsResolver } from '../net/coalescing-dns-resolver.js'
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
    address === '127.0.0.1' || address === '::1' ? false : isBlockedAddress(address),
  // Not relaxed: recognising an address is not part of what these specs need
  // to bend, so it stays the real implementation.
  isIpLiteral: DEFAULT_URL_POLICY.isIpLiteral
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

describe('PlaywrightAxeAuditor URL safety', () => {
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

  it('refuses a literal private address', async () => {
    await expect(sut.audit('http://169.254.169.254/latest/meta-data/', signal()))
      .rejects.toThrow(/net::ERR_BLOCKED_BY_CLIENT/)
  })

  it('refuses a public page that redirects to a private one', async () => {
    // The case the issue's own mechanism misses entirely: context.route fires
    // only for the first hop, so without the manual redirect walk this
    // RESOLVES and the private response is sitting in the page.
    await expect(sut.audit(`${server.baseUrl}/redirect-to-private`, signal()))
      .rejects.toThrow(/net::ERR_BLOCKED_BY_CLIENT/)
  })

  it('refuses a redirect into a non-http scheme', async () => {
    await expect(sut.audit(`${server.baseUrl}/redirect-to-file`, signal()))
      .rejects.toThrow(/net::ERR_BLOCKED_BY_CLIENT/)
  })

  it('refuses a redirect loop rather than following it forever', async () => {
    await expect(sut.audit(`${server.baseUrl}/redirect-loop`, signal()))
      .rejects.toThrow(/net::ERR_BLOCKED_BY_CLIENT/)
  }, 30_000)

  it('blocks a private subresource but still audits the page', async () => {
    // One hostile embed must not make an otherwise fine page un-auditable.
    const result = await sut.audit(`${server.baseUrl}/private-subresource`, signal())

    expect(result.violations.map((violation) => violation.ruleId)).toContain('label')
    expect(result.settled).toBe(true)
  }, 30_000)

  it('refuses to let an audited page register a service worker', async () => {
    // Requests a service worker makes are not reliably intercepted by
    // context.route, so a page allowed to register one could issue requests
    // straight past the guard. Driven through a real context rather than by
    // reading the options object back, which would only agree with itself.
    const browser = await chromium.launch()
    const context = await browser.newContext(AUDIT_CONTEXT_OPTIONS)
    try {
      const page = await context.newPage()
      await page.goto(`${server.baseUrl}/service-worker-page`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(500)

      const registrations = await page.evaluate(async () => {
        // Reached through a cast for the same reason the adapter does it: this
        // body runs in the browser but is typechecked in a Node project whose
        // lib is ES2023, and adding "DOM" would make browser globals look
        // available throughout the server.
        const browserGlobals = globalThis as unknown as {
          navigator: { serviceWorker: { getRegistrations: () => Promise<unknown[]> } }
        }
        return (await browserGlobals.navigator.serviceWorker.getRegistrations()).length
      })

      expect(registrations).toBe(0)
    } finally {
      await context.close()
      await browser.close()
    }
  }, 60_000)

  /**
   * Waits for the page to reach a settled outcome rather than sleeping.
   * A fixed delay made this assertion vacuous: the page was often still
   * 'pending' when it was read, so "not open" held whether the socket was
   * refused or merely slow - and the mutation check passed with the whole
   * WebSocket registration deleted.
   */
  const socketOutcome = async (page: Page): Promise<string> => {
    await page.waitForFunction(
      () => (globalThis as unknown as { __socketOutcome: string }).__socketOutcome !== 'pending',
      undefined,
      { timeout: 10_000 }
    )
    return await page.evaluate(() =>
      (globalThis as unknown as { __socketOutcome: string }).__socketOutcome)
  }

  it('refuses a WebSocket the page opens', async () => {
    // Isolated from the HTTP guard on purpose. With the guard installed the
    // socket closes either way, because fetching and fulfilling a navigation
    // also breaks the upgrade handshake - so a combined test cannot attribute
    // the block to anything, and passed with this registration deleted.
    // Measured: routeWebSocket alone gives 'closed', a bare context 'open'.
    //
    // The incidental block is not something to rely on. It is a side effect of
    // how navigations are served, and would disappear the moment that changed.
    const browser = await chromium.launch()
    const context = await browser.newContext(AUDIT_CONTEXT_OPTIONS)
    try {
      await context.routeWebSocket('**/*', (ws) => { ws.close() })
      const page = await context.newPage()
      await page.goto(`${server.baseUrl}/websocket-page`, { waitUntil: 'domcontentloaded' })

      expect(await socketOutcome(page)).toBe('closed')
    } finally {
      await context.close()
      await browser.close()
    }
  }, 60_000)

  it('control: the same page opens a socket with no WebSocket guard', async () => {
    // Without this the test above would pass just as happily against a broken
    // fixture server, proving nothing.
    const browser = await chromium.launch()
    const context = await browser.newContext(AUDIT_CONTEXT_OPTIONS)
    try {
      const page = await context.newPage()
      await page.goto(`${server.baseUrl}/websocket-page`, { waitUntil: 'domcontentloaded' })

      expect(await socketOutcome(page)).toBe('open')
    } finally {
      await context.close()
      await browser.close()
    }
  }, 60_000)

  it('the audit context refuses sockets however it is wired', async () => {
    // Integration, not attribution: this holds through routeWebSocket and, as
    // it happens, through the navigation guard too. It documents the guarantee
    // the auditor makes; the isolated test above is what pins the mechanism.
    const browser = await chromium.launch()
    const context = await browser.newContext(AUDIT_CONTEXT_OPTIONS)
    try {
      await installGuards(
        context,
        makeRequestGuard(new CoalescingDnsResolver(new NodeDnsResolver()), allowingFixtureServer)
      )
      const page = await context.newPage()
      await page.goto(`${server.baseUrl}/websocket-page`, { waitUntil: 'domcontentloaded' })

      expect(await socketOutcome(page)).not.toBe('open')
    } finally {
      await context.close()
      await browser.close()
    }
  }, 60_000)

  it('leaves an audited page no WebRTC to reach an internal host with', async () => {
    // Neither route nor routeWebSocket intercepts WebRTC, a data channel needs
    // no permission, and Chromium will send packets to whatever ICE candidate
    // address the page supplies. Asserted in a real browser rather than
    // against Node's globalThis, where making the property non-configurable
    // cannot be undone afterwards.
    const browser = await chromium.launch()
    const context = await browser.newContext(AUDIT_CONTEXT_OPTIONS)
    try {
      await installGuards(
        context,
        makeRequestGuard(new CoalescingDnsResolver(new NodeDnsResolver()), allowingFixtureServer)
      )
      const page = await context.newPage()
      await page.goto(server.baseUrl, { waitUntil: 'domcontentloaded' })

      const probe = await page.evaluate(() => {
        const globals = globalThis as unknown as Record<string, unknown>
        let reinstated = 'no'
        try {
          globals.RTCPeerConnection = function () { /* attempt to restore */ }
          reinstated = typeof globals.RTCPeerConnection
        } catch { reinstated = 'threw' }
        return {
          rtc: typeof globals.RTCPeerConnection,
          // WebTransport rides QUIC and is intercepted by neither route nor
          // routeWebSocket either, so it is the same hole by another name.
          webTransport: typeof globals.WebTransport,
          dataChannel: typeof globals.RTCDataChannel,
          reinstated
        }
      })

      expect(probe.rtc).toBe('undefined')
      expect(probe.webTransport).toBe('undefined')
      expect(probe.dataChannel).toBe('undefined')
      // A page that could simply reassign it would have gained nothing from
      // the removal.
      expect(probe.reinstated).not.toBe('function')
    } finally {
      await context.close()
      await browser.close()
    }
  }, 60_000)

  it('refuses a file:// URL before it ever reaches the network guard', async () => {
    // A route handler is a NETWORK boundary, and file: never produces an
    // interceptable HTTP request - so without the pre-navigation check this
    // would read the worker's own disk.
    await expect(sut.audit('file:///etc/passwd', signal()))
      .rejects.toThrow(/net::ERR_BLOCKED_BY_CLIENT/)
  })

  it('refuses a data: URL the same way', async () => {
    await expect(sut.audit('data:text/html,<h1>hi</h1>', signal()))
      .rejects.toThrow(/net::ERR_BLOCKED_BY_CLIENT/)
  })

  it('keeps the browser at the redirected URL, so relative assets still resolve', async () => {
    // Collapsing the chain - fulfilling the final body against the original
    // request - leaves the document at the START url. Measured: /start ->
    // /dir/page kept the page at /start and resolved <img src="asset.png"> to
    // /asset.png, a 404, while running the target's content under the start
    // origin. Here the target pulls a RELATIVE script that injects an
    // alt-less image, so the violation only appears if the base URL is right.
    const result = await sut.audit(`${server.baseUrl}/redirect-to-dir`, signal())

    expect(result.violations.map((violation) => violation.ruleId)).toContain('image-alt')
  }, 30_000)

  it('still audits an ordinary page unchanged', async () => {
    // The control. The guard rewrites how every navigation is fetched, so
    // proving normal auditing is untouched matters as much as the blocks.
    const result = await sut.audit(server.baseUrl, signal())

    expect(result.violations.map((violation) => violation.ruleId)).toContain('image-alt')
    expect(result.axeVersion).toBe(VENDORED_VERSION)
    expect(result.settled).toBe(true)
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
