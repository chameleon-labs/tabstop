import { chromium, type Browser, type BrowserContext } from 'playwright'
import { fileURLToPath } from 'node:url'
import { isIP } from 'node:net'
import type { Impact } from '../../domain/models/impact.js'
import type { AuditPageResult, PageAuditor } from '../../data/protocols/audit/page-auditor.js'
import type { DnsResolver } from '../../data/protocols/net/dns-resolver.js'
import { CoalescingDnsResolver } from '../net/coalescing-dns-resolver.js'
import { makeRequestGuard, type RouteLike } from './request-guard.js'
import {
  DEFAULT_URL_POLICY, bareHostname, parseAuditUrl, type UrlPolicy
} from '../../domain/services/url-safety.js'

const AXE_PATH = fileURLToPath(new URL('./vendor/axe.min.js', import.meta.url))

export type AuditBudgets = {
  navigationMs: number
  settleMs: number
  fallbackSettleMs: number
}

/** What the browser hands back. Impact is nullable in axe's own results. */
type EvaluatedResult = {
  axeVersion: string
  violations: Array<{
    ruleId: string
    impact: string | null
    description: string
    helpUrl: string
    nodes: Array<{ target: string[], html: string }>
  }>
}

/**
 * Exported so a spec can prove these hold by driving a real context, rather
 * than by reading the object back and agreeing with itself.
 */
/**
 * Removed before any page script runs.
 *
 * WebRTC and WebTransport are intercepted by neither `route` nor
 * `routeWebSocket`. A data channel needs no permission and will send packets
 * to whatever ICE candidate address a page supplies; WebTransport opens QUIC
 * to any host. Both are direct paths to an internal address past every check
 * here. Non-configurable so a page cannot put them back.
 *
 * This covers pages and frames. Init scripts do not reach dedicated workers,
 * so a worker could still construct either - closing that needs enforcement
 * below the browser, recorded with the download gap on #16.
 */
export const DISABLE_UNINTERCEPTED_TRANSPORTS = (): void => {
  // WebTransport rides QUIC and is intercepted by neither route nor
  // routeWebSocket either, so an https page could open one straight to a
  // private endpoint on 443.
  for (const name of [
    'RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'WebTransport'
  ]) {
    Object.defineProperty(globalThis, name, {
      value: undefined, configurable: false, writable: false
    })
  }
}

export const AUDIT_CONTEXT_OPTIONS = {
  viewport: { width: 1280, height: 720 },
  // Nothing is ever saved. This does NOT stop the request being issued -
  // measured: a download reaches the server with this false, and with the
  // download event cancelled - but it keeps hostile bytes off the worker's
  // disk. See the residual recorded in DECISIONS.md and on #16.
  acceptDownloads: false,
  // context.route does not reliably intercept requests made by a service
  // worker, and service workers are enabled by default - so an audited page
  // could register one and issue requests straight past the guard.
  serviceWorkers: 'block',
  // Load-bearing. A well-configured Content-Security-Policy blocks the
  // injected engine, so without this we fail on exactly the sites most likely
  // to have been built carefully. Verified: addScriptTag throws "Executing
  // inline script violates the following Content Security Policy" when false.
  bypassCSP: true
} as const

/**
 * Runs in the BROWSER: page.evaluate serialises this function, so it may not
 * reference anything in this module. Exported and kept self-contained for that
 * reason, and so it can be exercised directly in Node against a stand-in
 * global rather than only through a real page.
 *
 * The globals are reached through a cast because this file is typechecked as
 * part of a Node project - `lib` is ES2024, and adding "DOM" would make
 * `document`, `window` and `localStorage` compile throughout the server, while
 * a per-file `/// <reference lib="dom" />` leaks program-wide (verified). #38
 * moves this into its own DOM-typed compilation unit and removes the cast.
 *
 * Until then the cast is at least CHECKED rather than merely asserted: the
 * shape is verified before use, so an axe that is absent or has changed shape
 * fails with a message the classifier maps to an engine failure instead of
 * producing an undefined-property error somewhere downstream.
 */
export const runAxeInPage = async (): Promise<EvaluatedResult> => {
  const browserGlobals = globalThis as unknown as {
    document?: unknown
    axe?: {
      run?: (context: unknown, options: { resultTypes: string[] }) => Promise<unknown>
    }
  }

  const axe = browserGlobals.axe
  if (axe === undefined || typeof axe.run !== 'function') {
    // Wording matters: the classifier matches this as a permanent engine
    // failure, so the user is told the engine could not run rather than
    // seeing three retries of an unrecognised error.
    throw new Error('axe is not defined on the page')
  }

  const run = await axe.run(browserGlobals.document, { resultTypes: ['violations'] }) as {
    testEngine?: { version?: unknown }
    violations?: unknown
  }

  if (typeof run?.testEngine?.version !== 'string' || !Array.isArray(run.violations)) {
    throw new Error('axe returned an unrecognised result shape')
  }

  return {
    axeVersion: run.testEngine.version,
    violations: (run.violations as Array<{
      id: string
      impact: string | null
      description: string
      helpUrl: string
      nodes: Array<{ target: Array<string | string[]>, html: string }>
    }>).map((violation) => ({
      ruleId: violation.id,
      impact: violation.impact,
      description: violation.description,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map((node) => ({
        // axe does not always hand back a flat list of selectors: a node
        // inside shadow DOM arrives as a NESTED array, verified as
        // [["#host","img"]]. Flattening here keeps `string[]` true all the way
        // down, and ' >>> ' is Playwright's own shadow-piercing notation so
        // the result still reads as a selector path.
        target: node.target.map((entry) => Array.isArray(entry) ? entry.join(' >>> ') : entry),
        html: node.html
      }))
    }))
  }
}

/**
 * Just the two methods this needs, taken from Playwright's own type rather
 * than restated: a handler parameter is contravariant, so any hand-written
 * stand-in would have to name `Route` exactly to be satisfied by a real
 * context - at which point restating it buys nothing and can drift.
 */
export type GuardedContext = Pick<BrowserContext, 'route' | 'routeWebSocket' | 'addInitScript'>

/**
 * Both interceptors, registered together because leaving either off is a hole
 * rather than a degradation.
 *
 * `context.route` does not see WebSockets at all, so without the second
 * registration a page could open `ws://10.0.0.5/` and reach straight past
 * every check the first one performs. Nothing an accessibility audit needs
 * arrives over a socket, so they are refused outright rather than validated -
 * there is no useful "safe WebSocket" case to preserve here.
 */
export const installGuards = async (
  context: GuardedContext,
  guard: (route: RouteLike) => Promise<void>
): Promise<void> => {
  // The one place Playwright's Route is translated into the guard's own
  // contract. It cannot be structural: Route.fulfill takes Playwright's
  // APIResponse, so satisfying RouteLike structurally would mean importing
  // Playwright into request-guard.ts and losing the boundary that makes the
  // guard unit-testable at all. An adapter converting a vendor type into a
  // local port is exactly where a cast earns its place.
  await context.addInitScript(DISABLE_UNINTERCEPTED_TRANSPORTS)
  await context.route('**/*', (route) => guard(route as unknown as RouteLike))
  await context.routeWebSocket('**/*', (ws) => { ws.close() })
}

/**
 * The same rules the route guard applies, run before the first navigation.
 *
 * The duplication is deliberate: the guard is a NETWORK boundary, and a scheme
 * that never produces an interceptable HTTP request slips underneath it - a
 * `file:///` audit could read the worker's own disk before the guard ever saw
 * a request.
 */
const isNavigable = async (
  url: string, resolver: DnsResolver, policy: UrlPolicy
): Promise<boolean> => {
  const parsed = parseAuditUrl(url, policy)
  if (!parsed.safe) return false

  const host = bareHostname(parsed.url)
  if (isIP(host) !== 0) return !policy.isBlockedAddress(host)

  const addresses = await resolver.resolve(host)
  return addresses.length > 0 && addresses.every((address) => !policy.isBlockedAddress(address))
}

const IMPACTS: readonly string[] = ['minor', 'moderate', 'serious', 'critical']

/**
 * axe reports `impact: null` for a violation whose failing checks carry no
 * severity, and could in principle report a value we do not model. Neither is
 * a reason to discard a real finding - marking an audit `done` while dropping
 * violations would be a lie - so an unrecognised severity becomes null and the
 * violation is stored uncounted.
 */
const toImpact = (value: string | null): Impact | null =>
  value !== null && IMPACTS.includes(value) ? value as Impact : null

/**
 * The only file in the codebase that imports Playwright, and the only place an
 * axe result exists. Everything it returns is already in the repository's
 * shape.
 */
export class PlaywrightAxeAuditor implements PageAuditor {
  /**
   * The in-flight launch, not the browser. Caching the resolved browser with
   * `??=` re-reads the field only AFTER awaiting, so concurrent first audits
   * all see null and each launches its own Chromium - measured at three
   * launches for three callers, orphaning two. Caching the promise makes the
   * second caller await the first launch instead of starting another.
   */
  private launching: Promise<Browser> | null = null

  constructor (
    private readonly budgets: AuditBudgets,
    private readonly dnsResolver: DnsResolver,
    /**
     * Overridden only by integration tests, which must serve fixtures from
     * loopback on an ephemeral port - both of which the real policy refuses,
     * and rightly so. They relax exactly those two and leave every other range
     * enforced, so the blocking those specs assert is real policy at work.
     */
    private readonly urlPolicy?: UrlPolicy
  ) {}

  /**
   * Launched lazily and reused for the process's lifetime. Launching per job
   * costs about a second and heavy memory churn; the CONTEXT is the isolation
   * boundary, and that is what has to be fresh.
   */
  private async getBrowser (): Promise<Browser> {
    const pending = this.launching
    if (pending !== null) {
      const browser = await pending
      // A crashed browser stays cached otherwise, and every retry of the
      // deliberately-transient "browser crashed" failure would call
      // newContext() on the same dead object - so the retry could never
      // succeed, which defeats the point of classifying it as retryable.
      if (browser.isConnected()) return browser
      if (this.launching === pending) this.launching = null
    }

    this.launching ??= chromium.launch().catch((error: unknown) => {
      // A failed launch must not stay cached as a rejected promise, or every
      // later audit re-throws it for the life of the process.
      this.launching = null
      throw error
    })

    return await this.launching
  }

  async audit (url: string, signal: AbortSignal): Promise<AuditPageResult> {
    // An already-aborted signal fires no 'abort' event, so the listener added
    // below would never run and the audit would proceed as though it still had
    // budget - launching a browser for work nobody is waiting for.
    signal.throwIfAborted()

    const startedAt = Date.now()
    const browser = await this.getBrowser()

    const context = await browser.newContext(AUDIT_CONTEXT_OPTIONS)

    // Every request the page makes is checked, not only the navigation: a page
    // can embed <img src="http://169.254.169.254/..."> and the worker would
    // fetch it from inside the network. Nothing reaches the user either way -
    // axe reads the DOM, not image bytes - so this is about side effects
    // rather than disclosure, but a GET that changes state still fires.
    //
    // The resolver is wrapped per AUDIT and coalesces only lookups that are
    // in flight together - it never holds a completed answer. Caching one
    // would mean validating an address once and trusting it for the rest of an
    // audit that can run for tens of seconds, which is long enough to flip DNS
    // underneath it.
    // Shared with the pre-navigation check below, so one host resolves once.
    const guardResolver = new CoalescingDnsResolver(this.dnsResolver)
    const policy = this.urlPolicy ?? DEFAULT_URL_POLICY
    const guard = makeRequestGuard(guardResolver, policy)
    await installGuards(context, guard)

    // A timed-out job must kill the browser, not merely stop awaiting it -
    // otherwise the work carries on unattended with a live Chromium behind it.
    // `void` discards the value, NOT the rejection. If the browser has already
    // crashed, close() rejects and Node treats an unhandled rejection as fatal
    // - killing the worker instead of letting the job be retried. The awaited
    // close in `finally` is what reports a genuine cleanup failure.
    const abort = (): void => { void context.close().catch(() => undefined) }
    signal.addEventListener('abort', abort, { once: true })

    try {
      // Launching Chromium and opening a context take real time, and an abort
      // during that window has already fired - so the listener just registered
      // will never run. Without this re-check the audit would run to
      // completion for a job whose budget expired before it began.
      signal.throwIfAborted()

      const page = await context.newPage()
      // An alert() blocks navigation until something answers it. Both of these
      // race with teardown - the page can be gone by the time they fire - so
      // their rejections are swallowed rather than left to kill the process.
      page.on('dialog', (dialog) => { void dialog.dismiss().catch(() => undefined) })
      context.on('page', (popup) => { void popup.close().catch(() => undefined) })

      // The submitted URL is checked BEFORE navigating, not only by the route
      // guard. A route handler is a network boundary, and `file:` and `data:`
      // are not guaranteed to produce an interceptable HTTP request at all -
      // a file:/// audit could read the worker's own disk before the guard
      // ever saw a request. This is the same policy, applied one layer up.
      if (!await isNavigable(url, guardResolver, policy)) {
        throw new Error(`net::ERR_BLOCKED_BY_CLIENT at ${url}`)
      }

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.budgets.navigationMs
      })

      let settled = true
      try {
        await page.waitForLoadState('networkidle', { timeout: this.budgets.settleMs })
      } catch {
        // Analytics beacons, polling and live chat widgets keep the network
        // busy forever. Auditing anyway is the right product call; recording
        // that we did is what stops a hollow result reading as a clean one.
        settled = false
        await page.waitForTimeout(this.budgets.fallbackSettleMs)
      }

      await page.addScriptTag({ path: AXE_PATH })

      // Mapped INSIDE the browser. Measured on a fixture: the raw result
      // serialises to 42,996 bytes and 41,922 with resultTypes - a 2.5%
      // saving, not the "dramatic" one the issue assumed - while returning
      // only the mapped violations is 621 bytes, because `passes` never
      // crosses the CDP boundary at all. It also means no axe type ever
      // exists in Node, so the protocol boundary is real rather than nominal.
      // Mapped INSIDE the browser. Measured on a fixture: the raw result
      // serialises to 42,996 bytes and 41,922 with resultTypes - a 2.5%
      // saving, not the "dramatic" one the issue assumed - while returning
      // only the mapped violations is 621 bytes, because `passes` never
      // crosses the CDP boundary at all. It also means no axe type ever
      // exists in Node, so the protocol boundary is real rather than nominal.
      const evaluated = await page.evaluate(runAxeInPage)

      return {
        violations: evaluated.violations.map((violation) => ({
          ...violation,
          impact: toImpact(violation.impact)
        })),
        axeVersion: evaluated.axeVersion,
        durationMs: Date.now() - startedAt,
        settled
      }
    } finally {
      signal.removeEventListener('abort', abort)
      await context.close()
    }
  }

  /** Closes the shared browser. Called on worker shutdown. */
  async close (): Promise<void> {
    const pending = this.launching
    this.launching = null
    if (pending === null) return

    // Await the in-flight launch rather than ignoring it: a browser that
    // finishes launching after shutdown began would otherwise outlive the
    // process's intent to stop.
    const browser = await pending.catch(() => null)
    if (browser !== null && browser.isConnected()) await browser.close()
  }

  /** Test seam: lets a spec assert contexts were torn down. */
  async contextCount (): Promise<number> {
    if (this.launching === null) return 0
    const browser = await this.launching.catch(() => null)
    return browser?.contexts().length ?? 0
  }
}
