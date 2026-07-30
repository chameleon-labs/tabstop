import { UnrecoverableError } from 'bullmq'
import { env } from './config/env.js'
import { connectDatabase, disconnectDatabase } from './config/database.js'
import {
  QUEUE_NAMES, type AuditPayload, type PingPayload, type ReauditPayload
} from './config/queue-names.js'
import {
  makeQueue, makeWorker, setGlobalConcurrency, upsertDailySchedule
} from '../infra/queue/helpers/bullmq-helper.js'
import { runWithTimeout } from '../infra/queue/run-with-timeout.js'
import { PermanentAuditError } from '../domain/errors/permanent-audit-error.js'
import {
  closePageAuditor, makeRunAudit
} from './factories/usecases/run-audit/run-audit-factory.js'
import { getDatabase } from './config/database.js'
import { PostgresSessionRepository } from '../infra/db/postgres/session/postgres-session-repository.js'
import { startSessionSweeper } from './maintenance/session-sweeper.js'
import {
  REAUDIT_ATTEMPTS, REAUDIT_CRON, REAUDIT_RETRY_BACKOFF_MS, REAUDIT_SCHEDULER_ID, REAUDIT_TIMEZONE
} from './config/reaudit.js'
import { makeRunScheduledReaudits } from './factories/usecases/reaudit/reaudit-factory.js'

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

// Before the audit worker exists, because a Worker starts pulling jobs the
// moment it is constructed. Every audit is ~30s of Chromium at 300-500MB, so
// this is the cost backstop the per-IP rate limit is not: the limit bounds one
// source, and this bounds the whole system regardless of how many sources or
// how many worker replicas there are.
await setGlobalConcurrency(QUEUE_NAMES.audit, env.redisUrl, env.auditConcurrency)

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

// The nightly re-audit (#13), which is what makes this a monitoring product
// rather than a one-off audit tool.
//
// A BullMQ job scheduler rather than a timer, and deliberately NOT for the
// reason the session sweeper below is a timer. That one avoids Redis because
// authentication must not depend on it; this job's entire output is BullMQ
// jobs, so Redis is already on its critical path - and a timer would fire once
// per worker replica, racing N fan-outs over the same rows every night. The
// schedule lives in Redis and fires once however many workers are running.
const reauditQueue = makeQueue<ReauditPayload>(QUEUE_NAMES.reaudit, env.redisUrl)

reauditQueue.on('error', (error) => {
  console.error('Re-audit queue error (Redis connection):', error)
})

await upsertDailySchedule(
  reauditQueue, REAUDIT_SCHEDULER_ID, REAUDIT_CRON, REAUDIT_TIMEZONE,
  { attempts: REAUDIT_ATTEMPTS, backoff: { type: 'exponential', delay: REAUDIT_RETRY_BACKOFF_MS } }
)

const reauditWorker = makeWorker<ReauditPayload>(
  QUEUE_NAMES.reaudit, env.redisUrl, async () => {
    const startedAt = Date.now()
    // The clock is read here rather than taken from the job, so a run retried
    // after an outage schedules for the day it actually runs on.
    const summary = await makeRunScheduledReaudits().run(new Date())

    // One structured line per run, emitted even when there was nothing to do.
    // A scheduler that stops firing breaks this product silently - nothing
    // errors, users simply stop being told their pages got worse - so the
    // absence of this line is the signal. #25 forwards it to PostHog.
    console.log(JSON.stringify({
      event: 'reaudit-run', ...summary, durationMs: Date.now() - startedAt
    }))

    // Thrown AFTER the summary is logged, so the record of what happened
    // survives the failure. Retrying is safe and cheap: every page the attempt
    // did schedule now has an audit in flight and is excluded from the
    // eligibility query, so the next attempt picks up only what is still owed.
    if (summary.failed > 0) {
      throw new Error(`Re-audit run could not schedule ${summary.failed} page(s)`)
    }
  }
)

// Expired sessions were enforced at read time but never removed, so the
// table only grew - one row per login, forever. This runs here rather than in
// the API because the API scales horizontally and would have N instances
// issuing the same delete, and because the worker already owns background
// work and a database connection.
//
// Left as a timer rather than folded into the scheduler above, which #13's
// comment proposed: #10's design turns on authentication not depending on
// Redis, and a repeatable job would make session maintenance do exactly that.
const sessionSweeper = startSessionSweeper(new PostgresSessionRepository(getDatabase()))

const workers = [pingWorker, auditWorker, reauditWorker]

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
  `Worker started, consuming "${QUEUE_NAMES.ping}", "${QUEUE_NAMES.audit}" and ` +
  `"${QUEUE_NAMES.reaudit}" (audit concurrency ${env.auditConcurrency}, enforced across all ` +
  `workers; re-audit fan-out at "${REAUDIT_CRON}" ${REAUDIT_TIMEZONE})`
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
      // The queue holds its own Redis connection, separate from the worker's.
      await reauditQueue.close()
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
