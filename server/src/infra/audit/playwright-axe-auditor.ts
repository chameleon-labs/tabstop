import { chromium, type Browser } from 'playwright'
import { fileURLToPath } from 'node:url'
import type { Impact } from '../../domain/models/impact.js'
import type { AuditPageResult, PageAuditor } from '../../data/protocols/audit/page-auditor.js'
import type { AddViolationParams } from '../../data/protocols/db/violation/add-violations-repository.js'

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

const IMPACTS: readonly string[] = ['minor', 'moderate', 'serious', 'critical']

const isImpact = (value: string | null): value is Impact =>
  value !== null && IMPACTS.includes(value)

/**
 * The only file in the codebase that imports Playwright, and the only place an
 * axe result exists. Everything it returns is already in the repository's
 * shape.
 */
export class PlaywrightAxeAuditor implements PageAuditor {
  private browser: Browser | null = null

  constructor (private readonly budgets: AuditBudgets) {}

  /**
   * Launched lazily and reused for the process's lifetime. Launching per job
   * costs about a second and heavy memory churn; the CONTEXT is the isolation
   * boundary, and that is what has to be fresh.
   */
  private async getBrowser (): Promise<Browser> {
    this.browser ??= await chromium.launch()
    return this.browser
  }

  async audit (url: string, signal: AbortSignal): Promise<AuditPageResult> {
    // An already-aborted signal fires no 'abort' event, so the listener added
    // below would never run and the audit would proceed as though it still had
    // budget - launching a browser for work nobody is waiting for.
    signal.throwIfAborted()

    const startedAt = Date.now()
    const browser = await this.getBrowser()

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      // Load-bearing. A well-configured Content-Security-Policy blocks the
      // injected engine, so without this we fail on exactly the sites most
      // likely to have been built carefully. Verified: addScriptTag throws
      // "Executing inline script violates the following Content Security
      // Policy" when this is false.
      bypassCSP: true
    })

    // A timed-out job must kill the browser, not merely stop awaiting it -
    // otherwise the work carries on unattended with a live Chromium behind it.
    const abort = (): void => { void context.close() }
    signal.addEventListener('abort', abort, { once: true })

    try {
      const page = await context.newPage()
      // An alert() blocks navigation until something answers it.
      page.on('dialog', (dialog) => { void dialog.dismiss() })
      context.on('page', (popup) => { void popup.close() })

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
                nodes: Array<{ target: string[], html: string }>
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
            nodes: violation.nodes.map((node) => ({ target: node.target, html: node.html }))
          }))
        }
      })

      return {
        // axe's impact is nullable. A violation without one is dropped rather
        // than guessed at: `violations.impact` is NOT NULL with a check
        // constraint, and inventing a severity would corrupt the counts that
        // regression detection compares.
        violations: evaluated.violations.filter(
          (violation): violation is AddViolationParams & { impact: Impact } =>
            isImpact(violation.impact)
        ),
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
    await this.browser?.close()
    this.browser = null
  }

  /** Test seam: lets a spec assert contexts were torn down. */
  contextCount (): number {
    return this.browser?.contexts().length ?? 0
  }
}
