import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { makeDatabase } from './src/infra/db/postgres/helpers/postgres-helper.js'
import { runMigrations } from './src/infra/db/postgres/migrations/migrator.js'

let postgres: StartedPostgreSqlContainer | null = null
let redis: StartedRedisContainer | null = null

export async function setup (): Promise<void> {
  try {
    postgres = await new PostgreSqlContainer('postgres:17-alpine').start()
    const connectionString = postgres.getConnectionUri()
    process.env.DATABASE_URL = connectionString

    redis = await new RedisContainer('redis:8-alpine').start()
    process.env.REDIS_URL = redis.getConnectionUrl()

    const db = makeDatabase(connectionString)
    try {
      await runMigrations(db)
    } finally {
      await db.destroy()
    }
  } catch (error) {
    // Vitest does not call teardown when setup throws, so anything already
    // started here would be orphaned. Stop it before rethrowing.
    await teardown()
    throw error
  }
}

export async function teardown (): Promise<void> {
  await postgres?.stop()
  postgres = null
  await redis?.stop()
  redis = null
}
