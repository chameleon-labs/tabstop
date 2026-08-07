import {chromium, type Browser, type BrowserContext} from 'playwright';
import {fileURLToPath} from 'node:url';
import type {Impact} from '../../domain/models/impact.js';
import type {AuditPageResult, PageAuditor} from '../../data/protocols/audit/page-auditor.js';
import type {DnsResolver} from '../../data/protocols/net/dns-resolver.js';
import {CoalescingDnsResolver} from '../net/coalescing-dns-resolver.js';
import {makeRequestGuard, type RouteLike} from './request-guard.js';
import {bareHostname, parseAuditUrl, type UrlPolicy} from '../../domain/services/url-safety.js';
import {DEFAULT_URL_POLICY} from '../net/ip-address-policy.js';
import {safeHelpUrl} from './help-url.js';
// Both run in the audited page, and live in a separate compilation unit
// because a `lib` is program-wide: DOM types belong to code that executes in a
// browser, not to a Node server. See browser/tsconfig.json and #38.
import {runAxeInPage, type EvaluatedResult} from './browser/run-axe-in-page.js';
import {DISABLE_UNINTERCEPTED_TRANSPORTS} from './browser/disable-unintercepted-transports.js';

const AXE_PATH = fileURLToPath(new URL('./vendor/axe.min.js', import.meta.url));

export type AuditBudgets = {
  navigationMs: number;
  settleMs: number;
  fallbackSettleMs: number;
};

/**
 * Re-exported because it is part of this module's surface even though it runs
 * in the page: `installGuards` registers it, and a spec proves the wiring by
 * driving a real context rather than by reading the object back and agreeing
 * with itself.
 */
export {DISABLE_UNINTERCEPTED_TRANSPORTS};

export const AUDIT_CONTEXT_OPTIONS = {
  viewport: {width: 1280, height: 720},
  // Keeps hostile bytes off the worker's disk. Measured: it does NOT stop the
  // request being issued. Residual recorded in DECISIONS.md and on #16.
  acceptDownloads: false,
  // context.route does not reliably intercept requests made by a service
  // worker, and service workers are enabled by default - so an audited page
  // could register one and issue requests straight past the guard.
  serviceWorkers: 'block',
  // Load-bearing. A well-configured Content-Security-Policy blocks the
  // injected engine, so without this we fail on exactly the sites most likely
  // to have been built carefully. Verified: addScriptTag throws "Executing
  // inline script violates the following Content Security Policy" when false.
  bypassCSP: true,
} as const;

/**
 * Re-exported for the same reason: it runs in the page, but `audit()` below
 * is what hands it to `page.evaluate`, and its spec drives it directly.
 */
export {runAxeInPage};

/**
 * Just the two methods this needs, taken from Playwright's own type rather
 * than restated: a handler parameter is contravariant, so any hand-written
 * stand-in would have to name `Route` exactly to be satisfied by a real
 * context - at which point restating it buys nothing and can drift.
 */
export type GuardedContext = Pick<BrowserContext, 'route' | 'routeWebSocket' | 'addInitScript'>;

/**
 * Everything that must happen to a violation AFTER it crosses back from the
 * page, and the crossing is the whole reason this is a separate function.
 *
 * `runAxeInPage` executes in the audited page's realm, where `URL` is as
 * replaceable as `axe` - so nothing it computes can be trusted, including a
 * validation it performs itself. This runs in Node, on the far side of
 * `page.evaluate`, with our own globals.
 *
 * Exported so the wiring is assertable. It was inline in `audit()` first, and
 * deleting the sanitiser there changed no test: the unit spec covered the
 * function and the integration spec drove a page whose real axe only ever
 * produces trusted links, so neither could see it go.
 */
export const toStoredViolations = (
  violations: EvaluatedResult['violations'],
): Array<Omit<EvaluatedResult['violations'][number], 'impact'> & {impact: Impact | null}> =>
  violations.map((violation) => ({
    ...violation,
    impact: toImpact(violation.impact),
    helpUrl: safeHelpUrl(violation.helpUrl),
  }));

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
  guard: (route: RouteLike) => Promise<void>,
): Promise<void> => {
  // Where Playwright's Route becomes the guard's own contract. It cannot be
  // structural - `Route.fulfill` takes Playwright's APIResponse, so matching
  // RouteLike structurally would drag Playwright into request-guard.ts and
  // lose the boundary that makes it unit-testable.
  await context.addInitScript(DISABLE_UNINTERCEPTED_TRANSPORTS);
  await context.route('**/*', (route) => guard(route as unknown as RouteLike));
  await context.routeWebSocket('**/*', (ws) => {
    ws.close();
  });
};

/**
 * The same rules the route guard applies, run before the first navigation.
 *
 * The duplication is deliberate: the guard is a NETWORK boundary, and a scheme
 * that never produces an interceptable HTTP request slips underneath it - a
 * `file:///` audit could read the worker's own disk before the guard ever saw
 * a request.
 */
const isNavigable = async (url: string, resolver: DnsResolver, policy: UrlPolicy): Promise<boolean> => {
  const parsed = parseAuditUrl(url, policy);
  if (!parsed.safe) return false;

  const host = bareHostname(parsed.url);
  if (policy.isIpLiteral(host)) return !policy.isBlockedAddress(host);

  const addresses = await resolver.resolve(host);
  return addresses.length > 0 && addresses.every((address) => !policy.isBlockedAddress(address));
};

const IMPACTS: readonly string[] = ['minor', 'moderate', 'serious', 'critical'];

/**
 * axe reports `impact: null` for a violation whose failing checks carry no
 * severity, and could in principle report a value we do not model. Neither is
 * a reason to discard a real finding - marking an audit `done` while dropping
 * violations would be a lie - so an unrecognised severity becomes null and the
 * violation is stored uncounted.
 */
const toImpact = (value: string | null): Impact | null =>
  value !== null && IMPACTS.includes(value) ? (value as Impact) : null;

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
  private launching: Promise<Browser> | null = null;

  constructor(
    private readonly budgets: AuditBudgets,
    private readonly dnsResolver: DnsResolver,
    /**
     * Overridden only by integration tests, which must serve fixtures from
     * loopback on an ephemeral port - both of which the real policy refuses,
     * and rightly so. They relax exactly those two and leave every other range
     * enforced, so the blocking those specs assert is real policy at work.
     */
    private readonly urlPolicy?: UrlPolicy,
  ) {}

  /**
   * Launched lazily and reused for the process's lifetime. Launching per job
   * costs about a second and heavy memory churn; the CONTEXT is the isolation
   * boundary, and that is what has to be fresh.
   */
  private async getBrowser(): Promise<Browser> {
    const pending = this.launching;
    if (pending !== null) {
      const browser = await pending;
      // Otherwise a crashed browser stays cached and every retry calls
      // newContext() on the same dead object, so it could never succeed.
      if (browser.isConnected()) return browser;
      if (this.launching === pending) this.launching = null;
    }

    this.launching ??= chromium.launch().catch((error: unknown) => {
      // A failed launch must not stay cached as a rejected promise, or every
      // later audit re-throws it for the life of the process.
      this.launching = null;
      throw error;
    });

    return await this.launching;
  }

  async audit(url: string, signal: AbortSignal): Promise<AuditPageResult> {
    // An already-aborted signal fires no 'abort' event, so the listener added
    // below would never run and the audit would proceed as though it still had
    // budget - launching a browser for work nobody is waiting for.
    signal.throwIfAborted();

    const startedAt = Date.now();
    const browser = await this.getBrowser();

    const context = await browser.newContext(AUDIT_CONTEXT_OPTIONS);

    // Every request is checked, not only the navigation: a page can embed
    // <img src="http://169.254.169.254/..."> and the worker would fetch it from
    // inside the network. About side effects rather than disclosure - axe reads
    // the DOM, not image bytes - but a GET that changes state still fires.
    //
    // Coalesces only lookups in flight together and never holds a completed
    // answer: caching one would validate an address once and trust it for an
    // audit long enough for DNS to flip underneath it. Shared with the
    // pre-navigation check, so one host resolves once.
    const guardResolver = new CoalescingDnsResolver(this.dnsResolver);
    const policy = this.urlPolicy ?? DEFAULT_URL_POLICY;
    const guard = makeRequestGuard(guardResolver, policy);
    await installGuards(context, guard);

    // A timed-out job must kill the browser, not merely stop awaiting it.
    // `void` discards the value, NOT the rejection: on an already-crashed
    // browser close() rejects, and an unhandled rejection is fatal in Node -
    // killing the worker instead of retrying the job. The awaited close in
    // `finally` reports a genuine cleanup failure.
    const abort = (): void => {
      void context.close().catch(() => undefined);
    };
    signal.addEventListener('abort', abort, {once: true});

    try {
      // Launching Chromium takes real time, and an abort during that window
      // has already fired, so the listener just registered will never run.
      signal.throwIfAborted();

      const page = await context.newPage();
      // An alert() blocks navigation until something answers it. Both of these
      // race with teardown - the page can be gone by the time they fire - so
      // their rejections are swallowed rather than left to kill the process.
      page.on('dialog', (dialog) => {
        void dialog.dismiss().catch(() => undefined);
      });
      context.on('page', (popup) => {
        void popup.close().catch(() => undefined);
      });

      // Checked BEFORE navigating, not only by the route guard: `file:` and
      // `data:` need not produce an interceptable HTTP request at all, so a
      // file:/// audit could read the worker's disk before the guard saw
      // anything. The same policy, one layer up.
      if (!(await isNavigable(url, guardResolver, policy))) {
        throw new Error(`net::ERR_BLOCKED_BY_CLIENT at ${url}`);
      }

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.budgets.navigationMs,
      });

      let settled = true;
      try {
        await page.waitForLoadState('networkidle', {timeout: this.budgets.settleMs});
      } catch {
        // Analytics beacons, polling and live chat widgets keep the network
        // busy forever. Auditing anyway is the right product call; recording
        // that we did is what stops a hollow result reading as a clean one.
        settled = false;
        await page.waitForTimeout(this.budgets.fallbackSettleMs);
      }

      await page.addScriptTag({path: AXE_PATH});

      // Mapped INSIDE the browser. Measured on a fixture: the raw result is
      // 42,996 bytes against 621 for the mapped violations, because `passes`
      // never crosses the CDP boundary. It also keeps every axe type out of
      // Node, making the protocol boundary real rather than nominal.
      const evaluated = await page.evaluate(runAxeInPage);

      return {
        violations: toStoredViolations(evaluated.violations),
        axeVersion: evaluated.axeVersion,
        durationMs: Date.now() - startedAt,
        settled,
      };
    } finally {
      signal.removeEventListener('abort', abort);
      await context.close();
    }
  }

  /** Closes the shared browser. Called on worker shutdown. */
  async close(): Promise<void> {
    const pending = this.launching;
    this.launching = null;
    if (pending === null) return;

    // Await the in-flight launch: a browser finishing after shutdown began
    // would otherwise outlive the process's intent to stop.
    const browser = await pending.catch(() => null);
    if (browser !== null && browser.isConnected()) await browser.close();
  }

  /** Test seam: lets a spec assert contexts were torn down. */
  async contextCount(): Promise<number> {
    if (this.launching === null) return 0;
    const browser = await this.launching.catch(() => null);
    return browser?.contexts().length ?? 0;
  }
}
