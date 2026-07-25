import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { makeDatabase } from './src/infra/db/postgres/helpers/postgres-helper.js'
import { runMigrations } from './src/infra/db/postgres/migrations/migrator.js'

let container: StartedPostgreSqlContainer | null = null

export async function setup (): Promise<void> {
  container = await new PostgreSqlContainer('postgres:17-alpine').start()
  const connectionString = container.getConnectionUri()
  process.env.DATABASE_URL = connectionString

  const db = makeDatabase(connectionString)
  try {
    await runMigrations(db)
  } finally {
    await db.destroy()
  }
}

export async function teardown (): Promise<void> {
  await container?.stop()
  container = null
}
