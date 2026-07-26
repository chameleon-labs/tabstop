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
    // started here would be orphaned. Stop it before rethrowing - but report a
    // stop failure rather than throwing it, so it cannot replace the setup
    // error that actually explains why the run failed.
    await teardown().catch((stopError: unknown) => {
      console.error('Failed to stop containers after setup failure:', stopError)
    })
    throw error
  }
}

export async function teardown (): Promise<void> {
  // Stop both independently. Awaiting them in sequence meant a rejected
  // postgres.stop() skipped redis.stop() entirely - orphaning a container in
  // the very failure path this teardown exists to clean up. Clearing the
  // handles first also keeps a second call from re-stopping a stopped
  // container.
  const stopping = [postgres?.stop(), redis?.stop()]
  postgres = null
  redis = null

  const results = await Promise.allSettled(stopping)
  const failures = results.filter((result) => result.status === 'rejected')
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      'Failed to stop one or more test containers'
    )
  }
}
