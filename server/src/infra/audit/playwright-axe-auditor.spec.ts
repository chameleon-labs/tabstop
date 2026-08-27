import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {chromium, type Page} from 'playwright';
import type {UrlPolicy} from '../../domain/services/url-safety.js';
import {DEFAULT_URL_POLICY, isBlockedAddress} from '../net/ip-address-policy.js';
import {NodeDnsResolver} from '../net/node-dns-resolver.js';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {AUDIT_CONTEXT_OPTIONS, PlaywrightAxeAuditor, installGuards} from './playwright-axe-auditor.js';
import {makeRequestGuard} from './request-guard.js';
import {CoalescingDnsResolver} from '../net/coalescing-dns-resolver.js';
import {startFixtureServer, type FixtureServer} from './test/fixture-server.js';

const VENDORED_VERSION = readFileSync(fileURLToPath(new URL('./vendor/VERSION', import.meta.url)), 'utf8').trim();

const BUDGETS = {navigationMs: 20_000, settleMs: 3_000, fallbackSettleMs: 500};

const allowingFixtureServer: UrlPolicy = {
  isAllowedPort: () => true,
  isBlockedAddress: (address) => (address === '127.0.0.1' || address === '::1' ? false : isBlockedAddress(address)),
  isIpLiteral: DEFAULT_URL_POLICY.isIpLiteral,
};

describe('PlaywrightAxeAuditor', () => {
  let server: FixtureServer;
  let sut: PlaywrightAxeAuditor;

  beforeAll(async () => {
    server = await startFixtureServer();
    sut = new PlaywrightAxeAuditor(BUDGETS, new NodeDnsResolver(), allowingFixtureServer);
  }, 60_000);

  afterAll(async () => {
    await sut.close();
    await server.close();
  });

  const signal = (): AbortSignal => new AbortController().signal;

  it('audits a page and reports its violations in the repository shape', async () => {
    const result = await sut.audit(server.baseUrl, signal());

    const ruleIds = result.violations.map((violation) => violation.ruleId);
    expect(ruleIds).toContain('image-alt');
    expect(ruleIds).toContain('label');
    expect(result.settled).toBe(true);
    expect(result.durationMs).toBeGreaterThan(0);

    expect(result.axeVersion).toBe(VENDORED_VERSION);
  });

  it('returns nodes carrying only target and html', async () => {
    const result = await sut.audit(server.baseUrl, signal());
    const node = result.violations[0]?.nodes[0];

    expect(Object.keys(node ?? {}).toSorted()).toEqual(['html', 'target']);
    expect(Array.isArray(node?.target)).toBe(true);
  });

  it('flattens a shadow-DOM selector rather than storing a nested array', async () => {
    const result = await sut.audit(`${server.baseUrl}/shadow`, signal());

    const targets = result.violations.flatMap((violation) => violation.nodes.map((node) => node.target));
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      for (const entry of target) {
        expect(typeof entry).toBe('string');
      }
    }
    expect(targets.some((target) => target.some((entry) => entry.includes('>>>')))).toBe(true);
  });

  it('reports only impacts the database will accept', async () => {
    const result = await sut.audit(server.baseUrl, signal());

    for (const violation of result.violations) {
      expect(['minor', 'moderate', 'serious', 'critical']).toContain(violation.impact);
    }
  });

  it('injects the engine through a blocking Content Security Policy', async () => {
    const result = await sut.audit(`${server.baseUrl}/csp`, signal());

    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('audits a page that never reaches network idle, and records that it did', async () => {
    const result = await sut.audit(`${server.baseUrl}/never-idle`, signal());

    expect(result.settled).toBe(false);
    expect(result.violations.map((violation) => violation.ruleId)).toContain('label');
  }, 30_000);

  it('closes the context on the failure path, not just the happy one', async () => {
    await expect(sut.audit('http://127.0.0.1:45999', signal())).rejects.toThrow(Error);

    expect(await sut.contextCount()).toBe(0);
  });

  it('surfaces navigation failures with the net:: code the classifier matches on', async () => {
    await expect(sut.audit('http://127.0.0.1:45999', signal())).rejects.toThrow(/net::ERR_CONNECTION_REFUSED/);
  });
});

describe('PlaywrightAxeAuditor URL safety', () => {
  let server: FixtureServer;
  let sut: PlaywrightAxeAuditor;

  beforeAll(async () => {
    server = await startFixtureServer();
    sut = new PlaywrightAxeAuditor(BUDGETS, new NodeDnsResolver(), allowingFixtureServer);
  }, 60_000);

  afterAll(async () => {
    await sut.close();
    await server.close();
  });

  const signal = (): AbortSignal => new AbortController().signal;

  it('refuses a literal private address', async () => {
    await expect(sut.audit('http://169.254.169.254/latest/meta-data/', signal())).rejects.toThrow(
      /net::ERR_BLOCKED_BY_CLIENT/,
    );
  });

  it('refuses a public page that redirects to a private one', async () => {
    await expect(sut.audit(`${server.baseUrl}/redirect-to-private`, signal())).rejects.toThrow(
      /net::ERR_BLOCKED_BY_CLIENT/,
    );
  });

  it('refuses a redirect into a non-http scheme', async () => {
    await expect(sut.audit(`${server.baseUrl}/redirect-to-file`, signal())).rejects.toThrow(
      /net::ERR_BLOCKED_BY_CLIENT/,
    );
  });

  it('refuses a redirect loop rather than following it forever', async () => {
    await expect(sut.audit(`${server.baseUrl}/redirect-loop`, signal())).rejects.toThrow(/net::ERR_BLOCKED_BY_CLIENT/);
  }, 30_000);

  it('blocks a private subresource but still audits the page', async () => {
    const result = await sut.audit(`${server.baseUrl}/private-subresource`, signal());

    expect(result.violations.map((violation) => violation.ruleId)).toContain('label');
    expect(result.settled).toBe(true);
  }, 30_000);

  it('refuses to let an audited page register a service worker', async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext(AUDIT_CONTEXT_OPTIONS);
    try {
      const page = await context.newPage();
      await page.goto(`${server.baseUrl}/service-worker-page`, {waitUntil: 'domcontentloaded'});
      await page.waitForTimeout(500);

      const registrations = await page.evaluate(async () => {
        const browserGlobals = globalThis as unknown as {
          navigator: {serviceWorker: {getRegistrations: () => Promise<unknown[]>}};
        };
        return (await browserGlobals.navigator.serviceWorker.getRegistrations()).length;
      });

      expect(registrations).toBe(0);
    } finally {
      await context.close();
      await browser.close();
    }
  }, 60_000);

  const socketOutcome = async (page: Page): Promise<string> => {
    await page.waitForFunction(
      // oxlint-disable-next-line no-underscore-dangle -- the fixture page's own global
      () => (globalThis as unknown as {__socketOutcome: string}).__socketOutcome !== 'pending',
      undefined,
      {timeout: 10_000},
    );
    // oxlint-disable-next-line no-underscore-dangle -- the fixture page's own global
    return await page.evaluate(() => (globalThis as unknown as {__socketOutcome: string}).__socketOutcome);
  };

  it('refuses a WebSocket the page opens', async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext(AUDIT_CONTEXT_OPTIONS);
    try {
      await context.routeWebSocket('**/*', (ws) => {
        ws.close();
      });
      const page = await context.newPage();
      await page.goto(`${server.baseUrl}/websocket-page`, {waitUntil: 'domcontentloaded'});

      expect(await socketOutcome(page)).toBe('closed');
    } finally {
      await context.close();
      await browser.close();
    }
  }, 60_000);

  it('control: the same page opens a socket with no WebSocket guard', async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext(AUDIT_CONTEXT_OPTIONS);
    try {
      const page = await context.newPage();
      await page.goto(`${server.baseUrl}/websocket-page`, {waitUntil: 'domcontentloaded'});

      expect(await socketOutcome(page)).toBe('open');
    } finally {
      await context.close();
      await browser.close();
    }
  }, 60_000);

  it('the audit context refuses sockets however it is wired', async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext(AUDIT_CONTEXT_OPTIONS);
    try {
      await installGuards(
        context,
        makeRequestGuard(new CoalescingDnsResolver(new NodeDnsResolver()), allowingFixtureServer),
      );
      const page = await context.newPage();
      await page.goto(`${server.baseUrl}/websocket-page`, {waitUntil: 'domcontentloaded'});

      expect(await socketOutcome(page)).not.toBe('open');
    } finally {
      await context.close();
      await browser.close();
    }
  }, 60_000);

  it('leaves an audited page no WebRTC to reach an internal host with', async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext(AUDIT_CONTEXT_OPTIONS);
    try {
      await installGuards(
        context,
        makeRequestGuard(new CoalescingDnsResolver(new NodeDnsResolver()), allowingFixtureServer),
      );
      const page = await context.newPage();
      await page.goto(server.baseUrl, {waitUntil: 'domcontentloaded'});

      const probe = await page.evaluate(() => {
        const globals = globalThis as unknown as Record<string, unknown>;
        let reinstated = 'no';
        try {
          globals.RTCPeerConnection = function RTCPeerConnection() {};
          reinstated = typeof globals.RTCPeerConnection;
        } catch {
          reinstated = 'threw';
        }
        return {
          rtc: typeof globals.RTCPeerConnection,
          webTransport: typeof globals.WebTransport,
          dataChannel: typeof globals.RTCDataChannel,
          reinstated,
        };
      });

      expect(probe.rtc).toBe('undefined');
      expect(probe.webTransport).toBe('undefined');
      expect(probe.dataChannel).toBe('undefined');
      expect(probe.reinstated).not.toBe('function');
    } finally {
      await context.close();
      await browser.close();
    }
  }, 60_000);

  it('refuses a file:// URL before it ever reaches the network guard', async () => {
    await expect(sut.audit('file:///etc/passwd', signal())).rejects.toThrow(/net::ERR_BLOCKED_BY_CLIENT/);
  });

  it('refuses a data: URL the same way', async () => {
    await expect(sut.audit('data:text/html,<h1>hi</h1>', signal())).rejects.toThrow(/net::ERR_BLOCKED_BY_CLIENT/);
  });

  it('keeps the browser at the redirected URL, so relative assets still resolve', async () => {
    const result = await sut.audit(`${server.baseUrl}/redirect-to-dir`, signal());

    expect(result.violations.map((violation) => violation.ruleId)).toContain('image-alt');
  }, 30_000);

  it('still audits an ordinary page unchanged', async () => {
    const result = await sut.audit(server.baseUrl, signal());

    expect(result.violations.map((violation) => violation.ruleId)).toContain('image-alt');
    expect(result.axeVersion).toBe(VENDORED_VERSION);
    expect(result.settled).toBe(true);
  });
});

describe('vendored engine in the build output', () => {
  it('reaches dist/ when a build has been run', () => {
    const dist = fileURLToPath(new URL('../../../dist/infra/audit/vendor/axe.min.js', import.meta.url));
    const distExists = existsSync(fileURLToPath(new URL('../../../dist', import.meta.url)));

    if (!distExists) {
      return;
    }
    expect(existsSync(dist)).toBe(true);
  });
});
