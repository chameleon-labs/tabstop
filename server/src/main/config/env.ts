export type Env = {
  port: number
  databaseUrl: string
  redisUrl: string
}

const DEFAULT_PORT = 3000

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

  const databaseUrl = source.DATABASE_URL
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL is required but was not set')
  }

  const redisUrl = source.REDIS_URL
  if (redisUrl === undefined || redisUrl === '') {
    throw new Error('REDIS_URL is required but was not set')
  }

  return {
    port: hasValidPort ? parsedPort : DEFAULT_PORT,
    databaseUrl,
    redisUrl
  }
}

export const env = parseEnv()
