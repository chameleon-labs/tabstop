import { chromium, type Browser } from 'playwright'
import { fileURLToPath } from 'node:url'
import type { Impact } from '../../domain/models/impact.js'
import type { AuditPageResult, PageAuditor } from '../../data/protocols/audit/page-auditor.js'
import type { DnsResolver } from '../../data/protocols/net/dns-resolver.js'
import { CoalescingDnsResolver } from '../net/coalescing-dns-resolver.js'
import { makeRequestGuard, type RouteLike } from './request-guard.js'
import type { UrlPolicy } from '../../domain/services/url-safety.js'

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
export const AUDIT_CONTEXT_OPTIONS = {
  viewport: { width: 1280, height: 720 },
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
    const guard = makeRequestGuard(new CoalescingDnsResolver(this.dnsResolver), this.urlPolicy)
    await context.route('**/*', (route) => guard(route as unknown as RouteLike))

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
      const evaluated = await page.evaluate(async (): Promise<EvaluatedResult> => {
        // This body executes in the browser, but it is TYPE-CHECKED as part of
        // a Node project whose lib is ES2023. Adding "DOM" to the compiler
        // options would fix the reference and quietly make `document`,
        // `fetch` and `window` look available throughout the server, so the
        // browser globals are reached through a local cast instead.
        const browserGlobals = globalThis as unknown as {
          document: unknown
          axe: {
            run: (context: unknown, options: { resultTypes: string[] }) => Promise<{
              testEngine: { version: string }
              violations: Array<{
                id: string
                impact: string | null
                description: string
                helpUrl: string
                nodes: Array<{ target: Array<string | string[]>, html: string }>
              }>
            }>
          }
        }

        const run = await browserGlobals.axe.run(
          browserGlobals.document, { resultTypes: ['violations'] }
        )

        return {
          axeVersion: run.testEngine.version,
          violations: run.violations.map((violation) => ({
            ruleId: violation.id,
            impact: violation.impact,
            description: violation.description,
            helpUrl: violation.helpUrl,
            nodes: violation.nodes.map((node) => ({
              // axe does not always hand back a flat list of selectors: a
              // node inside shadow DOM arrives as a NESTED array, verified as
              // [["#host","img"]]. Flattening here keeps `string[]` true all
              // the way down rather than storing a shape the type denies, and
              // ' >>> ' is Playwright's own shadow-piercing notation, so the
              // result still reads as a selector path.
              target: node.target.map(
                (entry) => Array.isArray(entry) ? entry.join(' >>> ') : entry
              ),
              html: node.html
            }))
          }))
        }
      })

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
