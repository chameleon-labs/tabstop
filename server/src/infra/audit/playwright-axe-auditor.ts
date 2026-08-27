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
import {runAxeInPage, type EvaluatedResult} from './browser/run-axe-in-page.js';
import {DISABLE_UNINTERCEPTED_TRANSPORTS} from './browser/disable-unintercepted-transports.js';

const AXE_PATH = fileURLToPath(new URL('./vendor/axe.min.js', import.meta.url));

export type AuditBudgets = {
  navigationMs: number;
  settleMs: number;
  fallbackSettleMs: number;
};

export {DISABLE_UNINTERCEPTED_TRANSPORTS};

export const AUDIT_CONTEXT_OPTIONS = {
  viewport: {width: 1280, height: 720},
  acceptDownloads: false,
  serviceWorkers: 'block',
  bypassCSP: true,
} as const;

export {runAxeInPage};

export type GuardedContext = Pick<BrowserContext, 'route' | 'routeWebSocket' | 'addInitScript'>;

export const toStoredViolations = (
  violations: EvaluatedResult['violations'],
): (Omit<EvaluatedResult['violations'][number], 'impact'> & {impact: Impact | null})[] =>
  violations.map((violation) => ({
    ...violation,
    impact: toImpact(violation.impact),
    helpUrl: safeHelpUrl(violation.helpUrl),
  }));

export const installGuards = async (
  context: GuardedContext,
  guard: (route: RouteLike) => Promise<void>,
): Promise<void> => {
  await context.addInitScript(DISABLE_UNINTERCEPTED_TRANSPORTS);
  await context.route('**/*', (route) => guard(route as unknown as RouteLike));
  await context.routeWebSocket('**/*', (ws) => {
    ws.close();
  });
};

const isNavigable = async (url: string, resolver: DnsResolver, policy: UrlPolicy): Promise<boolean> => {
  const parsed = parseAuditUrl(url, policy);
  if (!parsed.safe) {
    return false;
  }

  const host = bareHostname(parsed.url);
  if (policy.isIpLiteral(host)) {
    return !policy.isBlockedAddress(host);
  }

  const addresses = await resolver.resolve(host);
  return addresses.length > 0 && addresses.every((address) => !policy.isBlockedAddress(address));
};

const IMPACTS: ReadonlySet<string> = new Set(['minor', 'moderate', 'serious', 'critical']);

const toImpact = (value: string | null): Impact | null =>
  value !== null && IMPACTS.has(value) ? (value as Impact) : null;

export class PlaywrightAxeAuditor implements PageAuditor {
  private launching: Promise<Browser> | null = null;

  constructor(
    private readonly budgets: AuditBudgets,
    private readonly dnsResolver: DnsResolver,
    private readonly urlPolicy?: UrlPolicy,
  ) {}

  private async getBrowser(): Promise<Browser> {
    const pending = this.launching;
    if (pending !== null) {
      const browser = await pending;
      if (browser.isConnected()) {
        return browser;
      }
      if (this.launching === pending) {
        this.launching = null;
      }
    }

    this.launching ??= chromium.launch().catch((error: unknown) => {
      this.launching = null;
      throw error;
    });

    return await this.launching;
  }

  async audit(url: string, signal: AbortSignal): Promise<AuditPageResult> {
    signal.throwIfAborted();

    const startedAt = Date.now();
    const browser = await this.getBrowser();

    const context = await browser.newContext(AUDIT_CONTEXT_OPTIONS);

    const guardResolver = new CoalescingDnsResolver(this.dnsResolver);
    const policy = this.urlPolicy ?? DEFAULT_URL_POLICY;
    const guard = makeRequestGuard(guardResolver, policy);
    await installGuards(context, guard);

    const abort = (): void => {
      void context.close().catch(() => undefined);
    };
    signal.addEventListener('abort', abort, {once: true});

    try {
      signal.throwIfAborted();

      const page = await context.newPage();
      page.on('dialog', (dialog) => {
        void dialog.dismiss().catch(() => undefined);
      });
      context.on('page', (popup) => {
        void popup.close().catch(() => undefined);
      });

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
        settled = false;
        await page.waitForTimeout(this.budgets.fallbackSettleMs);
      }

      await page.addScriptTag({path: AXE_PATH});

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

  async close(): Promise<void> {
    const pending = this.launching;
    this.launching = null;
    if (pending === null) {
      return;
    }

    const browser = await pending.catch(() => null);
    if (browser !== null && browser.isConnected()) {
      await browser.close();
    }
  }

  async contextCount(): Promise<number> {
    if (this.launching === null) {
      return 0;
    }
    const browser = await this.launching.catch(() => null);
    return browser?.contexts().length ?? 0;
  }
}
