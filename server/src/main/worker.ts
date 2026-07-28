import { UnrecoverableError } from 'bullmq'
import { env } from './config/env.js'
import { connectDatabase, disconnectDatabase } from './config/database.js'
import { QUEUE_NAMES, type AuditPayload, type PingPayload } from './config/queue-names.js'
import { makeWorker } from '../infra/queue/helpers/bullmq-helper.js'
import { runWithTimeout } from '../infra/queue/run-with-timeout.js'
import { PermanentAuditError } from '../domain/errors/permanent-audit-error.js'
import {
  closePageAuditor, makeRunAudit
} from './factories/usecases/run-audit/run-audit-factory.js'
import { getDatabase } from './config/database.js'
import { PostgresSessionRepository } from '../infra/db/postgres/session/postgres-session-repository.js'
import { startSessionSweeper } from './maintenance/session-sweeper.js'

const PING_TIMEOUT_MS = 10_000

// The audit job reads and writes audit rows, so unlike the ping-only worker
// this process now needs a database connection of its own.
connectDatabase(env.databaseUrl)

const pingWorker = makeWorker<PingPayload>(QUEUE_NAMES.ping, env.redisUrl, async (job) => {
  // The signal is intentionally unused: this handler has nothing to abort.
  await runWithTimeout(PING_TIMEOUT_MS, async () => {
    console.log(`ping received, requested at ${job.data.requestedAt}`)
  })
})

const auditWorker = makeWorker<AuditPayload>(QUEUE_NAMES.audit, env.redisUrl, async (job) => {
  await runWithTimeout(env.auditJobTimeoutMs, async (signal) => {
    const attempts = job.opts.attempts ?? 1

    try {
      await makeRunAudit().run({
        auditId: job.data.auditId,
        // Passed down so a timed-out job closes the browser context rather
        // than leaving a Chromium running unattended.
        signal,
        // attemptsMade counts the attempts already finished, so this one is
        // the last when it has reached attempts - 1.
        isFinalAttempt: job.attemptsMade >= attempts - 1
      })
    } catch (error) {
      // The queue's vocabulary stops here. The usecase raises a domain error,
      // and this is the only place that knows how to tell BullMQ to give up -
      // which is what keeps data/ testable with no queue at all.
      if (error instanceof PermanentAuditError) throw new UnrecoverableError(error.message)
      throw error
    }
  })
}, {
  concurrency: env.auditConcurrency,
  // Defaults to 30s while an audit may run for its full budget. Automatic
  // renewal is the only reason that default is ever safe, and the job-runtime
  // decision said this job should set it explicitly rather than inherit it.
  lockDuration: env.auditJobTimeoutMs + 15_000
})

// Expired sessions were enforced at read time but never removed, so the
// table only grew - one row per login, forever. This runs here rather than in
// the API because the API scales horizontally and would have N instances
// issuing the same delete, and because the worker already owns background
// work and a database connection.
const sessionSweeper = startSessionSweeper(new PostgresSessionRepository(getDatabase()))

const workers = [pingWorker, auditWorker]

for (const worker of workers) {
  worker.on('failed', (job, error) => {
    console.error(`Job ${job?.id ?? 'unknown'} failed:`, error)
  })

  worker.on('error', (error) => {
    console.error('Worker error (connection or lock renewal):', error)
  })
}

await Promise.all(workers.map(async (worker) => { await worker.waitUntilReady() }))
console.log(
  `Worker started, consuming "${QUEUE_NAMES.ping}" and "${QUEUE_NAMES.audit}" ` +
  `(audit concurrency ${env.auditConcurrency})`
)

const shutdown = (signal: string): void => {
  console.log(`${signal} received, shutting down`)

  // Must stay above the longest per-job timeout, or a SIGTERM arriving
  // mid-audit force-exits before the job can finish and leaves the row
  // stranded in `running`.
  const forceExit = setTimeout(() => {
    console.error('Shutdown timed out, forcing exit')
    process.exit(1)
  }, env.auditJobTimeoutMs + 30_000)
  forceExit.unref()

  // close() waits for in-flight jobs rather than dropping them. The browser
  // and the pool are torn down afterwards, so nothing is pulled out from under
  // a job that is still finishing.
  void Promise.all(workers.map(async (worker) => { await worker.close() }))
    .then(async () => {
      sessionSweeper.stop()
      await closePageAuditor()
      await disconnectDatabase()
      process.exit(0)
    })
    .catch((error: unknown) => {
      // Exit non-zero so a supervisor can tell a failed teardown from a clean
      // one, matching server.ts and the force-exit path above.
      console.error('Error closing the worker:', error)
      process.exit(1)
    })
}

process.on('SIGTERM', () => { shutdown('SIGTERM') })
process.on('SIGINT', () => { shutdown('SIGINT') })
