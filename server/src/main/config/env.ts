import { isValidScryptCost } from '../../infra/cryptography/scrypt-adapter.js'

export type Env = {
  port: number
  databaseUrl: string
  redisUrl: string
  frontendOrigin: string
  sessionCookieSecure: boolean
  scryptCost: number
  sessionTtlDays: number
}

const DEFAULT_PORT = 3000
const DEFAULT_SCRYPT_COST = 32768
const DEFAULT_SESSION_TTL_DAYS = 30

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
  raw: string | undefined, fallback: number, name: string
): number => {
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer, but was "${raw}"`)
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

  return {
    port: hasValidPort ? parsedPort : DEFAULT_PORT,
    databaseUrl: required(source, 'DATABASE_URL'),
    redisUrl: required(source, 'REDIS_URL'),
    frontendOrigin: requiredOrigin(source, 'FRONTEND_ORIGIN'),
    sessionCookieSecure: requiredBoolean(source, 'SESSION_COOKIE_SECURE'),
    // A tuning knob, not a correctness knob: CI lowers it, production must not.
    scryptCost: scryptCostOr(source.SCRYPT_COST, DEFAULT_SCRYPT_COST),
    sessionTtlDays: positiveIntegerOr(
      source.SESSION_TTL_DAYS, DEFAULT_SESSION_TTL_DAYS, 'SESSION_TTL_DAYS'
    )
  }
}

export const env = parseEnv()
