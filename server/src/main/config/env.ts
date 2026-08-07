import {isValidScryptCost} from '../../infra/cryptography/scrypt-adapter.js';

export type Env = {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  frontendOrigin: string;
  publicApiOrigin: string;
  mailDriver: 'console' | 'resend';
  resendApiKey: string | null;
  mailFrom: string;
  alertUnsubscribeSecret: string;
  sessionCookieSecure: boolean;
  scryptCost: number;
  sessionTtlDays: number;
  auditConcurrency: number;
  auditJobTimeoutMs: number;
  auditNavigationTimeoutMs: number;
  auditSettleBudgetMs: number;
  auditFallbackSettleMs: number;
  /**
   * How many reverse proxies sit in front of this process. Express takes the
   * X-Forwarded-For entry that many positions from the right - the last one a
   * client could not have written.
   */
  trustProxyHops: number;
  auditRateCapacity: number;
  auditRatePerHour: number;
  auditQueueMaxDepth: number;
  /**
   * Server-side bound on any single statement issued by the API or the worker.
   * The per-job timeouts bound the attempt, not the query underneath it, so
   * without this a statement stuck on a lock holds its pooled connection
   * indefinitely - and the pool is small and shared (#52).
   */
  databaseStatementTimeoutMs: number;
};

const DEFAULT_PORT = 3000;
const DEFAULT_SCRYPT_COST = 32768;
const DEFAULT_SESSION_TTL_DAYS = 30;

/**
 * Browsers cap cookie expiry at 400 days (RFC 6265bis), so a longer session
 * cannot be honoured: the browser clamps silently while the row keeps the
 * longer expiry, which is the cookie/row divergence taking `expiresAt` from
 * the persisted session exists to prevent.
 *
 * It also keeps the arithmetic inside Date's range - past it, node-postgres
 * serialises the Invalid Date to something Postgres rejects, so an absurd TTL
 * would 500 every signup rather than merely being an odd setting.
 */
const MAX_SESSION_TTL_DAYS = 400;

/** Zero trusts nothing. #16 sets the real hop count for its topology. */
const DEFAULT_TRUST_PROXY_HOPS = 0;
const MAX_TRUST_PROXY_HOPS = 8;
const DEFAULT_AUDIT_RATE_CAPACITY = 5;
const DEFAULT_AUDIT_RATE_PER_HOUR = 5;
/**
 * The aggregate backstop the per-IP buckets cannot provide: those bound one
 * source each, while the queue is shared by all of them. Roughly an hour of
 * backlog at the default concurrency of one, so an accepted client still gets
 * a result rather than a place in a line nobody reaches. The ceiling is what
 * keeps a stray zero from removing the bound entirely.
 */
const DEFAULT_AUDIT_QUEUE_MAX_DEPTH = 100;
const MAX_AUDIT_QUEUE_MAX_DEPTH = 10_000;
/**
 * Production-tunable, which is exactly why it needs a ceiling: unlike a typo
 * in a timeout, AUDIT_RATE_CAPACITY=50000 boots cleanly and silently removes
 * the limit that makes this endpoint safe to deploy. 1000 is far past what 16
 * concurrent Chromium contexts could sustain, so it catches a stray zero
 * without constraining any real deployment.
 */
const MAX_AUDIT_RATE_CAPACITY = 1000;
const MAX_AUDIT_RATE_PER_HOUR = 1000;

const DEFAULT_AUDIT_CONCURRENCY = 1;
/**
 * Chromium is roughly 300-500MB per context, so the safe default is one audit
 * at a time. #8 owns raising it once #16 has sized the worker instance.
 */
const MAX_AUDIT_CONCURRENCY = 16;
const DEFAULT_AUDIT_JOB_TIMEOUT_MS = 45_000;
const DEFAULT_AUDIT_NAVIGATION_TIMEOUT_MS = 20_000;
const DEFAULT_AUDIT_SETTLE_BUDGET_MS = 10_000;
const DEFAULT_AUDIT_FALLBACK_SETTLE_MS = 1_000;
/** Ten minutes. Beyond this a stuck audit is a bug, not a slow page. */
const MAX_AUDIT_TIMEOUT_MS = 600_000;

/**
 * Room inside the job budget for everything the navigation budgets do not
 * cover: injecting the engine, running it, and writing the result.
 */
const AUDIT_EXECUTION_HEADROOM_MS = 10_000;

/**
 * Comfortably beyond every query this codebase issues - the slowest are the
 * history reads in #48, which are index-served and measured in milliseconds.
 * The point is not the number but having one at all: a statement blocked on a
 * lock currently runs forever and keeps a pooled connection while it does.
 */
const DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS = 30_000;
/**
 * A ceiling for the same reason every other numeric variable here has one: a
 * stray extra zero would boot cleanly and quietly restore the unbounded
 * behaviour this exists to remove. Five minutes is far longer than any request
 * or job should ever hold a connection.
 */
const MAX_DATABASE_STATEMENT_TIMEOUT_MS = 300_000;

const required = (source: NodeJS.ProcessEnv, name: string): string => {
  const value = source[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is required but was not set`);
  }
  return value;
};

/**
 * Required rather than defaulted in either direction. Defaulted to false,
 * production ships insecure cookies if anyone forgets; defaulted to true, local
 * login fails silently over http. Neither failure announces itself.
 */
const requiredBoolean = (source: NodeJS.ProcessEnv, name: string): boolean => {
  const value = required(source, name);
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be "true" or "false", but was "${value}"`);
  }
  return value === 'true';
};

/**
 * A browser's `Origin` header is scheme + host + port and nothing else, so the
 * configured value has to be exactly that: `*` is invalid on a credentialed
 * request, and a trailing slash or path can never equal an Origin. Either would
 * boot cleanly and then fail every authenticated browser request - the failure
 * this fail-fast rule exists to move to startup.
 */
const requiredOrigin = (source: NodeJS.ProcessEnv, name: string): string => {
  const value = required(source, name);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http(s) origin, but was "${value}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use http or https, but was "${value}"`);
  }
  if (parsed.origin !== value) {
    throw new Error(
      `${name} must be exactly an origin, with no path or trailing slash - ` +
        `expected "${parsed.origin}" but was "${value}"`,
    );
  }

  return parsed.origin;
};

const mailDriver = (source: NodeJS.ProcessEnv): 'console' | 'resend' => {
  const value = source.MAIL_DRIVER;
  if (value === undefined || value === '') return 'console';
  if (value !== 'console' && value !== 'resend') {
    throw new Error(`MAIL_DRIVER must be "console" or "resend", but was "${value}"`);
  }
  return value;
};

const alertUnsubscribeSecret = (source: NodeJS.ProcessEnv): string => {
  const secret = required(source, 'ALERT_UNSUBSCRIBE_SECRET');
  if (Buffer.byteLength(secret) < 32) {
    throw new Error('ALERT_UNSUBSCRIBE_SECRET must contain at least 32 bytes');
  }
  return secret;
};

/**
 * Unset means "use the default". Set means the operator had an intention, so an
 * unusable value is a configuration error and must not be silently replaced by
 * the default - that is how a deliberate change becomes a no-op nobody notices.
 */
const positiveIntegerOr = (
  raw: string | undefined,
  fallback: number,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number => {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer, but was "${raw}"`);
  }
  if (parsed > maximum) {
    throw new Error(`${name} must be at most ${maximum}, but was "${raw}"`);
  }
  return parsed;
};

/**
 * Mirrors positiveIntegerOr, but trustProxyHops has a meaningful zero - "no
 * proxy in front of this process" - so the floor has to allow it.
 */
const nonNegativeIntegerOr = (
  raw: string | undefined,
  fallback: number,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number => {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, but was "${raw}"`);
  }
  if (parsed > maximum) {
    throw new Error(`${name} must be at most ${maximum}, but was "${raw}"`);
  }
  return parsed;
};

/**
 * A cost that is merely a positive integer still breaks scrypt at runtime: it
 * must be a power of two, and must fit within maxmem. Left unchecked, a value
 * like 20000 boots cleanly and then fails every signup with a 500 while login
 * keeps working from stored digests - a partial breakage that is easy to miss.
 */
const scryptCostOr = (raw: string | undefined, fallback: number): number => {
  const cost = positiveIntegerOr(raw, fallback, 'SCRYPT_COST');
  if (!isValidScryptCost(cost)) {
    throw new Error(`SCRYPT_COST must be a power of two that fits scrypt's memory budget, but was "${cost}"`);
  }
  return cost;
};

/**
 * One schema for both processes. Today the API uses only databaseUrl and the
 * worker only redisUrl, so each process demands a variable it does not use -
 * deploy config must supply both to both. Splitting this is deliberate future
 * work: the audit worker will need Postgres, and the audits API will need the
 * queue, at which point the asymmetry disappears on its own.
 */
export const parseEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const rawPort = source.PORT;
  const parsedPort = Number(rawPort);
  const hasValidPort = rawPort !== undefined && rawPort !== '' && Number.isFinite(parsedPort);
  const databaseUrl = required(source, 'DATABASE_URL');
  const redisUrl = required(source, 'REDIS_URL');
  const frontendOrigin = requiredOrigin(source, 'FRONTEND_ORIGIN');
  const sessionCookieSecure = requiredBoolean(source, 'SESSION_COOKIE_SECURE');

  const auditJobTimeoutMs = positiveIntegerOr(
    source.AUDIT_JOB_TIMEOUT_MS,
    DEFAULT_AUDIT_JOB_TIMEOUT_MS,
    'AUDIT_JOB_TIMEOUT_MS',
    MAX_AUDIT_TIMEOUT_MS,
  );
  const auditNavigationTimeoutMs = positiveIntegerOr(
    source.AUDIT_NAVIGATION_TIMEOUT_MS,
    DEFAULT_AUDIT_NAVIGATION_TIMEOUT_MS,
    'AUDIT_NAVIGATION_TIMEOUT_MS',
    MAX_AUDIT_TIMEOUT_MS,
  );
  const auditSettleBudgetMs = positiveIntegerOr(
    source.AUDIT_SETTLE_BUDGET_MS,
    DEFAULT_AUDIT_SETTLE_BUDGET_MS,
    'AUDIT_SETTLE_BUDGET_MS',
    MAX_AUDIT_TIMEOUT_MS,
  );
  const auditFallbackSettleMs = positiveIntegerOr(
    source.AUDIT_FALLBACK_SETTLE_MS,
    DEFAULT_AUDIT_FALLBACK_SETTLE_MS,
    'AUDIT_FALLBACK_SETTLE_MS',
    MAX_AUDIT_TIMEOUT_MS,
  );

  // Validating each budget alone is not enough: they are nested, and the outer
  // one always wins. A 600s navigation budget under a 45s job budget is
  // accepted by every individual check and can never be reached - the job
  // aborts first, so the navigation timeout and the specific, actionable
  // message mapped to it become dead configuration.
  const innerBudget =
    auditNavigationTimeoutMs + auditSettleBudgetMs + auditFallbackSettleMs + AUDIT_EXECUTION_HEADROOM_MS;
  if (innerBudget > auditJobTimeoutMs) {
    throw new Error(
      'AUDIT_JOB_TIMEOUT_MS must leave room for the navigation budgets: ' +
        `navigation + settle + fallback + ${AUDIT_EXECUTION_HEADROOM_MS}ms of execution ` +
        `headroom is ${innerBudget}ms, which exceeds AUDIT_JOB_TIMEOUT_MS of ${auditJobTimeoutMs}ms`,
    );
  }

  const selectedMailDriver = mailDriver(source);
  const resendApiKey = selectedMailDriver === 'resend' ? required(source, 'RESEND_API_KEY') : null;
  const publicApiOrigin = requiredOrigin(source, 'PUBLIC_API_ORIGIN');
  if (selectedMailDriver === 'resend' && !publicApiOrigin.startsWith('https://')) {
    throw new Error('PUBLIC_API_ORIGIN must use https when MAIL_DRIVER=resend');
  }

  return {
    port: hasValidPort ? parsedPort : DEFAULT_PORT,
    databaseUrl,
    redisUrl,
    frontendOrigin,
    publicApiOrigin,
    mailDriver: selectedMailDriver,
    resendApiKey,
    mailFrom: required(source, 'MAIL_FROM'),
    alertUnsubscribeSecret: alertUnsubscribeSecret(source),
    sessionCookieSecure,
    // A tuning knob, not a correctness knob: CI lowers it, production must not.
    scryptCost: scryptCostOr(source.SCRYPT_COST, DEFAULT_SCRYPT_COST),
    sessionTtlDays: positiveIntegerOr(
      source.SESSION_TTL_DAYS,
      DEFAULT_SESSION_TTL_DAYS,
      'SESSION_TTL_DAYS',
      MAX_SESSION_TTL_DAYS,
    ),
    auditConcurrency: positiveIntegerOr(
      source.AUDIT_CONCURRENCY,
      DEFAULT_AUDIT_CONCURRENCY,
      'AUDIT_CONCURRENCY',
      MAX_AUDIT_CONCURRENCY,
    ),
    auditJobTimeoutMs,
    auditNavigationTimeoutMs,
    auditSettleBudgetMs,
    auditFallbackSettleMs,
    trustProxyHops: nonNegativeIntegerOr(
      source.TRUST_PROXY_HOPS,
      DEFAULT_TRUST_PROXY_HOPS,
      'TRUST_PROXY_HOPS',
      MAX_TRUST_PROXY_HOPS,
    ),
    auditRateCapacity: positiveIntegerOr(
      source.AUDIT_RATE_CAPACITY,
      DEFAULT_AUDIT_RATE_CAPACITY,
      'AUDIT_RATE_CAPACITY',
      MAX_AUDIT_RATE_CAPACITY,
    ),
    auditRatePerHour: positiveIntegerOr(
      source.AUDIT_RATE_PER_HOUR,
      DEFAULT_AUDIT_RATE_PER_HOUR,
      'AUDIT_RATE_PER_HOUR',
      MAX_AUDIT_RATE_PER_HOUR,
    ),
    auditQueueMaxDepth: positiveIntegerOr(
      source.AUDIT_QUEUE_MAX_DEPTH,
      DEFAULT_AUDIT_QUEUE_MAX_DEPTH,
      'AUDIT_QUEUE_MAX_DEPTH',
      MAX_AUDIT_QUEUE_MAX_DEPTH,
    ),
    databaseStatementTimeoutMs: positiveIntegerOr(
      source.DATABASE_STATEMENT_TIMEOUT_MS,
      DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS,
      'DATABASE_STATEMENT_TIMEOUT_MS',
      MAX_DATABASE_STATEMENT_TIMEOUT_MS,
    ),
  };
};

export const env = parseEnv();
