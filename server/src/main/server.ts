import { setupApp } from './config/app.js'
import { env } from './config/env.js'
import { connectDatabase, disconnectDatabase, getDatabase } from './config/database.js'
import { PostgresHealthAdapter } from '../infra/db/postgres/health/postgres-health-adapter.js'

connectDatabase(env.databaseUrl)

const app = setupApp()

const server = app.listen(env.port, () => {
  console.log(`Server running at http://localhost:${env.port}`)
})

// The reachability probe is purely informational - a log line - so it must
// never gate the listener. An unreachable database degrades the service
// (503 from /api/health) rather than blocking boot.
void new PostgresHealthAdapter(getDatabase()).isReachable().then((reachable) => {
  console.log(
    reachable
      ? 'Database connection established'
      : 'Database unreachable - serving in degraded state, /api/health will report 503'
  )
})

const shutdown = (signal: string): void => {
  console.log(`${signal} received, shutting down`)

  const forceExit = setTimeout(() => {
    console.error('Shutdown timed out, forcing exit')
    process.exit(1)
  }, 10_000)
  forceExit.unref()

  server.close(() => {
    void disconnectDatabase()
      .then(() => { process.exit(0) })
      .catch((error: unknown) => {
        // Exit non-zero so a supervisor or CI can distinguish a failed teardown
        // from a clean one - matching the force-exit path above.
        console.error('Error closing the database pool:', error)
        process.exit(1)
      })
  })
  server.closeIdleConnections()
}

process.on('SIGTERM', () => { shutdown('SIGTERM') })
process.on('SIGINT', () => { shutdown('SIGINT') })
