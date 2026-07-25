export type Env = {
  port: number
  databaseUrl: string
}

const DEFAULT_PORT = 3000

export const parseEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const rawPort = source.PORT
  const parsedPort = Number(rawPort)
  const hasValidPort = rawPort !== undefined && rawPort !== '' && Number.isFinite(parsedPort)

  const databaseUrl = source.DATABASE_URL
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL is required but was not set')
  }

  return {
    port: hasValidPort ? parsedPort : DEFAULT_PORT,
    databaseUrl
  }
}

export const env = parseEnv()
