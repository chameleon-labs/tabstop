import { isValidScryptCost } from '../../infra/cryptography/scrypt-adapter.js'

export type Env = {
  port: number
  databaseUrl: string
  redisUrl: string
  frontendOrigin: string
  sessionCookieSecure: boolean
  scryptCost: number
  sessionTtlDays: number
  auditConcurrency: number
  auditJobTimeoutMs: number
  auditNavigationTimeoutMs: number
  auditSettleBudgetMs: number
  auditFallbackSettleMs: number
  /**
   * How many reverse proxies sit in front of this process. Express takes the
   * X-Forwarded-For entry that many positions from the right - the last one a
   * client could not have written.
   */
  trustProxyHops: number
  auditRateCapacity: number
  auditRatePerHour: number
  auditQueueMaxDepth: number
}

const DEFAULT_PORT = 3000
const DEFAULT_SCRYPT_COST = 32768
const DEFAULT_SESSION_TTL_DAYS = 30

/**
 * Browsers cap cookie expiry at 400 days (RFC 6265bis; Chrome 104+ enforces
 * it), so a longer session cannot be honoured by the cookie anyway - the
 * browser would silently clamp it while the row kept the longer expiry,
 * reintroducing exactly the cookie/row divergence that taking expiresAt from
 * the persisted session exists to prevent.
 *
 * It also keeps the arithmetic inside Date's range. `Date.now() + days * 86400000`
 * overflows at about 99,979,338 days, and node-postgres serialises the
 * resulting Invalid Date as "0NaN-NaN-NaNTNaN:NaN:NaN.NaN+NaN:NaN", which
 * Postgres rejects - so an absurd TTL would 500 every signup and login rather
 * than merely being an odd setting.
 */
const MAX_SESSION_TTL_DAYS = 400

/** Zero trusts nothing. #16 sets the real hop count for its topology. */
const DEFAULT_TRUST_PROXY_HOPS = 0
const MAX_TRUST_PROXY_HOPS = 8
const DEFAULT_AUDIT_RATE_CAPACITY = 5
const DEFAULT_AUDIT_RATE_PER_HOUR = 5
/**
 * The aggregate backstop the per-IP buckets cannot provide: those bound one
 * source each, while the queue is shared by all of them. Roughly an hour of
 * backlog at the default concurrency of one, so an accepted client still gets
 * a result rather than a place in a line nobody reaches. The ceiling is what
 * keeps a stray zero from removing the bound entirely.
 */
const DEFAULT_AUDIT_QUEUE_MAX_DEPTH = 100
const MAX_AUDIT_QUEUE_MAX_DEPTH = 10_000
/**
 * This is the one dial documented as production-tunable, which is exactly
 * why it needs a ceiling like every other numeric variable in this file:
 * unlike a typo in a timeout, AUDIT_RATE_CAPACITY=50000 boots cleanly and
 * silently removes the limit that makes deploying this endpoint safe. 1000
 * is far beyond what MAX_AUDIT_CONCURRENCY (16 concurrent Chromium contexts)
 * could ever sustain, so it still catches a stray extra zero without
 * constraining any real deployment.
 */
const MAX_AUDIT_RATE_CAPACITY = 1000
const MAX_AUDIT_RATE_PER_HOUR = 1000

const DEFAULT_AUDIT_CONCURRENCY = 1
/**
 * Chromium is roughly 300-500MB per context, so the safe default is one audit
 * at a time. #8 owns raising it once #16 has sized the worker instance.
 */
const MAX_AUDIT_CONCURRENCY = 16
const DEFAULT_AUDIT_JOB_TIMEOUT_MS = 45_000
const DEFAULT_AUDIT_NAVIGATION_TIMEOUT_MS = 20_000
const DEFAULT_AUDIT_SETTLE_BUDGET_MS = 10_000
const DEFAULT_AUDIT_FALLBACK_SETTLE_MS = 1_000
/** Ten minutes. Beyond this a stuck audit is a bug, not a slow page. */
const MAX_AUDIT_TIMEOUT_MS = 600_000

/**
 * Room inside the job budget for everything the navigation budgets do not
 * cover: injecting the engine, running it, and writing the result.
 */
const AUDIT_EXECUTION_HEADROOM_MS = 10_000

const required = (source: NodeJS.ProcessEnv, name: string): string => {
  const value = source[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is required but was not set`)
  }
  return value
}

/**
 * Required rather than defaulted in either direction. Defaulted to false,
 * production ships insecure cookies if anyone forgets; defaulted to true, local
 * login fails silently over http. Neither failure announces itself.
 */
const requiredBoolean = (source: NodeJS.ProcessEnv, name: string): boolean => {
  const value = required(source, name)
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be "true" or "false", but was "${value}"`)
  }
  return value === 'true'
}

/**
 * A browser's `Origin` header is scheme + host + port and nothing else, so the
 * configured value has to be exactly that: `*` is invalid on a credentialed
 * request, and a trailing slash or path can never equal an Origin. Either would
 * boot cleanly and then fail every authenticated browser request - the failure
 * this fail-fast rule exists to move to startup.
 */
const requiredOrigin = (source: NodeJS.ProcessEnv, name: string): string => {
  const value = required(source, name)

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute http(s) origin, but was "${value}"`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use http or https, but was "${value}"`)
  }
  if (parsed.origin !== value) {
    throw new Error(
      `${name} must be exactly an origin, with no path or trailing slash - ` +
      `expected "${parsed.origin}" but was "${value}"`
    )
  }

  return parsed.origin
}

/**
 * Unset means "use the default". Set means the operator had an intention, so an
 * unusable value is a configuration error and must not be silently replaced by
 * the default - that is how a deliberate change becomes a no-op nobody notices.
 */
const positiveIntegerOr = (
  raw: string | undefined, fallback: number, name: string, maximum = Number.MAX_SAFE_INTEGER
): number => {
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer, but was "${raw}"`)
  }
  if (parsed > maximum) {
    throw new Error(`${name} must be at most ${maximum}, but was "${raw}"`)
  }
  return parsed
}

/**
 * Mirrors positiveIntegerOr, but trustProxyHops has a meaningful zero - "no
 * proxy in front of this process" - so the floor has to allow it.
 */
const nonNegativeIntegerOr = (
  raw: string | undefined, fallback: number, name: string, maximum = Number.MAX_SAFE_INTEGER
): number => {
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, but was "${raw}"`)
  }
  if (parsed > maximum) {
    throw new Error(`${name} must be at most ${maximum}, but was "${raw}"`)
  }
  return parsed
}

/**
 * A cost that is merely a positive integer still breaks scrypt at runtime: it
 * must be a power of two, and must fit within maxmem. Left unchecked, a value
 * like 20000 boots cleanly and then fails every signup with a 500 while login
 * keeps working from stored digests - a partial breakage that is easy to miss.
 */
const scryptCostOr = (raw: string | undefined, fallback: number): number => {
  const cost = positiveIntegerOr(raw, fallback, 'SCRYPT_COST')
  if (!isValidScryptCost(cost)) {
    throw new Error(
      `SCRYPT_COST must be a power of two that fits scrypt's memory budget, but was "${cost}"`
    )
  }
  return cost
}

/**
 * One schema for both processes. Today the API uses only databaseUrl and the
 * worker only redisUrl, so each process demands a variable it does not use -
 * deploy config must supply both to both. Splitting this is deliberate future
 * work: the audit worker will need Postgres, and the audits API will need the
 * queue, at which point the asymmetry disappears on its own.
 */
export const parseEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const rawPort = source.PORT
  const parsedPort = Number(rawPort)
  const hasValidPort = rawPort !== undefined && rawPort !== '' && Number.isFinite(parsedPort)

  const auditJobTimeoutMs = positiveIntegerOr(
    source.AUDIT_JOB_TIMEOUT_MS, DEFAULT_AUDIT_JOB_TIMEOUT_MS, 'AUDIT_JOB_TIMEOUT_MS',
    MAX_AUDIT_TIMEOUT_MS
  )
  const auditNavigationTimeoutMs = positiveIntegerOr(
    source.AUDIT_NAVIGATION_TIMEOUT_MS, DEFAULT_AUDIT_NAVIGATION_TIMEOUT_MS,
    'AUDIT_NAVIGATION_TIMEOUT_MS', MAX_AUDIT_TIMEOUT_MS
  )
  const auditSettleBudgetMs = positiveIntegerOr(
    source.AUDIT_SETTLE_BUDGET_MS, DEFAULT_AUDIT_SETTLE_BUDGET_MS, 'AUDIT_SETTLE_BUDGET_MS',
    MAX_AUDIT_TIMEOUT_MS
  )
  const auditFallbackSettleMs = positiveIntegerOr(
    source.AUDIT_FALLBACK_SETTLE_MS, DEFAULT_AUDIT_FALLBACK_SETTLE_MS,
    'AUDIT_FALLBACK_SETTLE_MS', MAX_AUDIT_TIMEOUT_MS
  )

  // Validating each budget alone is not enough: they are nested, and the outer
  // one always wins. A 600s navigation budget under a 45s job budget is
  // accepted by every individual check and can never be reached - the job
  // aborts first, so the navigation timeout and the specific, actionable
  // message mapped to it become dead configuration.
  const innerBudget =
    auditNavigationTimeoutMs + auditSettleBudgetMs + auditFallbackSettleMs +
    AUDIT_EXECUTION_HEADROOM_MS
  if (innerBudget > auditJobTimeoutMs) {
    throw new Error(
      'AUDIT_JOB_TIMEOUT_MS must leave room for the navigation budgets: ' +
      `navigation + settle + fallback + ${AUDIT_EXECUTION_HEADROOM_MS}ms of execution ` +
      `headroom is ${innerBudget}ms, which exceeds AUDIT_JOB_TIMEOUT_MS of ${auditJobTimeoutMs}ms`
    )
  }

  return {
    port: hasValidPort ? parsedPort : DEFAULT_PORT,
    databaseUrl: required(source, 'DATABASE_URL'),
    redisUrl: required(source, 'REDIS_URL'),
    frontendOrigin: requiredOrigin(source, 'FRONTEND_ORIGIN'),
    sessionCookieSecure: requiredBoolean(source, 'SESSION_COOKIE_SECURE'),
    // A tuning knob, not a correctness knob: CI lowers it, production must not.
    scryptCost: scryptCostOr(source.SCRYPT_COST, DEFAULT_SCRYPT_COST),
    sessionTtlDays: positiveIntegerOr(
      source.SESSION_TTL_DAYS, DEFAULT_SESSION_TTL_DAYS, 'SESSION_TTL_DAYS', MAX_SESSION_TTL_DAYS
    ),
    auditConcurrency: positiveIntegerOr(
      source.AUDIT_CONCURRENCY, DEFAULT_AUDIT_CONCURRENCY, 'AUDIT_CONCURRENCY',
      MAX_AUDIT_CONCURRENCY
    ),
    auditJobTimeoutMs,
    auditNavigationTimeoutMs,
    auditSettleBudgetMs,
    auditFallbackSettleMs,
    trustProxyHops: nonNegativeIntegerOr(
      source.TRUST_PROXY_HOPS, DEFAULT_TRUST_PROXY_HOPS, 'TRUST_PROXY_HOPS', MAX_TRUST_PROXY_HOPS
    ),
    auditRateCapacity: positiveIntegerOr(
      source.AUDIT_RATE_CAPACITY, DEFAULT_AUDIT_RATE_CAPACITY, 'AUDIT_RATE_CAPACITY',
      MAX_AUDIT_RATE_CAPACITY
    ),
    auditRatePerHour: positiveIntegerOr(
      source.AUDIT_RATE_PER_HOUR, DEFAULT_AUDIT_RATE_PER_HOUR, 'AUDIT_RATE_PER_HOUR',
      MAX_AUDIT_RATE_PER_HOUR
    ),
    auditQueueMaxDepth: positiveIntegerOr(
      source.AUDIT_QUEUE_MAX_DEPTH, DEFAULT_AUDIT_QUEUE_MAX_DEPTH, 'AUDIT_QUEUE_MAX_DEPTH',
      MAX_AUDIT_QUEUE_MAX_DEPTH
    )
  }
}

export const env = parseEnv()
