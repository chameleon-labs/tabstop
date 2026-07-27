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

const positiveIntegerOr = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
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
    // Exact origin: `*` is invalid on credentialed requests.
    frontendOrigin: required(source, 'FRONTEND_ORIGIN'),
    sessionCookieSecure: requiredBoolean(source, 'SESSION_COOKIE_SECURE'),
    // A tuning knob, not a correctness knob: CI lowers it, production must not.
    scryptCost: positiveIntegerOr(source.SCRYPT_COST, DEFAULT_SCRYPT_COST),
    sessionTtlDays: positiveIntegerOr(source.SESSION_TTL_DAYS, DEFAULT_SESSION_TTL_DAYS)
  }
}

export const env = parseEnv()
