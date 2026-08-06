import { UnrecoverableError } from 'bullmq'
import { env } from './config/env.js'
import { connectDatabase, disconnectDatabase } from './config/database.js'
import {
  QUEUE_NAMES, type AlertQueuePayload, type AuditPayload, type PingPayload, type ReauditPayload
} from './config/queue-names.js'
import {
  makeQueue, makeWorker, rateLimitForAtLeast, setGlobalConcurrency, upsertDailySchedule
} from '../infra/queue/helpers/bullmq-helper.js'
import { runWithTimeout } from '../infra/queue/run-with-timeout.js'
import { watchRedis } from '../infra/queue/helpers/redis-health.js'
import { PermanentAuditError } from '../domain/errors/permanent-audit-error.js'
import {
  closePageAuditor, makeRunAudit
} from './factories/usecases/run-audit/run-audit-factory.js'
import { getDatabase } from './config/database.js'
import { PostgresSessionRepository } from '../infra/db/postgres/session/postgres-session-repository.js'
import { startSessionSweeper } from './maintenance/session-sweeper.js'
import {
  REAUDIT_ATTEMPTS, REAUDIT_CRON, REAUDIT_HARD_STOP_MARGIN_MS, REAUDIT_RETRY_BACKOFF_MS,
  REAUDIT_RUN_TIMEOUT_MS, REAUDIT_SCHEDULER_ID, REAUDIT_TIMEZONE
} from './config/reaudit.js'
import { makeRunScheduledReaudits } from './factories/usecases/reaudit/reaudit-factory.js'
import type { ReauditRunSummary } from '../domain/usecases/run-scheduled-reaudits.js'
import { reauditRunFailure } from './jobs/reaudit-job-outcome.js'
import {
  ALERT_DISPATCH_CRON, ALERT_DISPATCH_TIMEZONE
} from './config/alert-email.js'
import {
  makeDispatchPendingAlertEmails, makeSendAlertEmail
} from './factories/usecases/alert/alert-worker-usecase-factories.js'
import { registerAlertEmailDispatcher } from './jobs/alert-email-scheduler.js'
import {
  ALERT_EMAIL_WORKER_LIMITER, makeAlertEmailJobProcessor
} from './jobs/alert-email-job-processor.js'

const PING_TIMEOUT_MS = 10_000

// The audit job reads and writes audit rows, so unlike the ping-only worker
// this process now needs a database connection of its own.
connectDatabase(env.databaseUrl)

/**
 * Before anything that talks to Redis, because the first thing that does is
 * where an unreachable Redis hangs.
 *
 * `setGlobalConcurrency` below is awaited, `ioredis` retries indefinitely, and
 * no worker exists yet to carry an error handler - so a Redis that is down used
 * to produce no error, no warning and no `Worker started` line, for as long as
 * anyone left it. The queue filled, the API stayed healthy, and the screen said
 * "Waiting for a free worker", which was true and unhelpful. See #83.
 */
const redis = watchRedis(env.redisUrl, console.log)

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

/**
 * Aborted by `shutdown` so the fan-out stops at its next page.
 *
 * A full run is minutes of sequential inserts and enqueues, far longer than
 * the shutdown grace, so a SIGTERM mid-run would otherwise reach the
 * force-exit timer - and a hard exit can land between creating an audit row
 * and queueing its job, stranding the row. Stopping cleanly leaves the
 * remaining pages simply unscheduled, which is what tomorrow's run is for.
 *
 * Separate from the timeout below, because they mean different things: this is
 * "we are going away", that is "this run is stuck".
 */
const reauditShutdown = new AbortController()

const reauditWorker = makeWorker<ReauditPayload>(
  QUEUE_NAMES.reaudit, env.redisUrl, async (job) => {
    const startedAt = Date.now()

    // TWO deadlines, and the gap between them is the point.
    //
    // The soft one is a signal the run honours, so it stops at its next page
    // and RETURNS a summary - which is what keeps a timed-out night
    // observable. The hard one is `runWithTimeout`, which rejects outright:
    // once it fires the return value is discarded no matter how cooperatively
    // the handler finished, so a run bounded only by it would produce no
    // record at all in exactly the case somebody most wants one.
    //
    // The hard bound stays because the soft one assumes the loop is running:
    // a run wedged in a query that never returns checks no signals, and
    // something has to end the attempt.
    //
    // It ends the ATTEMPT, and the work underneath is now bounded too.
    // `runWithTimeout` still only aborts a signal the queries never receive,
    // but the pool sets a statement_timeout (#52), so a lock-stalled statement
    // is cancelled by Postgres rather than holding its connection until the
    // loop happens to resume - which it could previously do after BullMQ had
    // already started the retry.
    //
    // The unique index and the eligibility query still matter: they are what
    // keeps a zombie and its retry from scheduling the same page twice, and
    // they cover the window between the attempt ending and the statement
    // being cancelled. The difference is that the window is now bounded by
    // DATABASE_STATEMENT_TIMEOUT_MS rather than open-ended.
    const softDeadline = AbortSignal.timeout(REAUDIT_RUN_TIMEOUT_MS)

    // The counters as of the last batch, kept for the path where the run
    // never gets to return them. An interrupted run has already scheduled real
    // audits; without this its numbers leave with the exception, the retry's
    // own summary covers only the tail, and nothing reconstructs the night.
    let progress: ReauditRunSummary | null = null

    const summary = await runWithTimeout(
      REAUDIT_RUN_TIMEOUT_MS + REAUDIT_HARD_STOP_MARGIN_MS,
      async (hardStop) => {
        // Any reason to stop stops the run: its own deadline, the hard bound,
        // or shutdown.
        const stop = AbortSignal.any([softDeadline, hardStop, reauditShutdown.signal])
        // The clock is read here rather than taken from the job, so a run
        // retried after an outage schedules for the day it actually runs on.
        return await makeRunScheduledReaudits().run(new Date(), {
          signal: stop,
          report: (partial) => { progress = partial }
        })
      }
    ).catch((error: unknown) => {
      // The hard bound fired, or the run threw. Still emit a record, with
      // whatever counters it had reached - a night that produced nothing but a
      // stack trace is a night nobody can reconstruct, and this is the one an
      // operator will come looking for.
      console.log(JSON.stringify({
        event: 'reaudit-run',
        outcome: 'aborted',
        ...(progress ?? {}),
        reason: error instanceof Error ? error.message : String(error),
        attempt: job.attemptsMade + 1,
        durationMs: Date.now() - startedAt
      }))
      throw error
    })

    // One structured line per run, emitted even when there was nothing to do.
    // A scheduler that stops firing breaks this product silently - nothing
    // errors, users simply stop being told their pages got worse - so the
    // absence of this line is the signal. #25 forwards it to PostHog.
    console.log(JSON.stringify({
      event: 'reaudit-run',
      outcome: 'completed',
      ...summary,
      attempt: job.attemptsMade + 1,
      durationMs: Date.now() - startedAt
    }))

    // Thrown AFTER the summary is logged, so the record of what happened
    // survives the failure. Retrying is safe and cheap: every page the attempt
    // did schedule now has an audit in flight and is excluded from the
    // eligibility query, so the next attempt picks up only what is still owed.
    const failure = reauditRunFailure(summary, reauditShutdown.signal.aborted)
    if (failure !== null) throw new Error(failure)
  }
)

// AlertEvent is the durable outbox; Redis is only its delivery mechanism.
// This minute-level dispatcher means an API/worker crash between recording a
// regression and touching Redis loses at most a minute, not the alert. Each
// send job has a deterministic id, so overlapping dispatch runs are harmless.
const alertQueue = makeQueue<AlertQueuePayload>(QUEUE_NAMES.alertEmail, env.redisUrl)
alertQueue.on('error', (error) => {
  console.error('Alert email queue error (Redis connection):', error)
})

await registerAlertEmailDispatcher(alertQueue)

const dispatchPendingAlertEmails = makeDispatchPendingAlertEmails(alertQueue)
const sendAlertEmail = makeSendAlertEmail()
const alertWorker = makeWorker<AlertQueuePayload>(
  QUEUE_NAMES.alertEmail,
  env.redisUrl,
  makeAlertEmailJobProcessor({
    rateLimit: async (durationMs) => {
      await rateLimitForAtLeast(alertQueue, durationMs)
    },
    dispatch: dispatchPendingAlertEmails.dispatch.bind(dispatchPendingAlertEmails),
    send: sendAlertEmail.send.bind(sendAlertEmail)
  }),
  { limiter: ALERT_EMAIL_WORKER_LIMITER }
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

const workers = [pingWorker, auditWorker, reauditWorker, alertWorker]

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
  `"${QUEUE_NAMES.reaudit}", and "${QUEUE_NAMES.alertEmail}" ` +
  `(audit concurrency ${env.auditConcurrency}, enforced across all workers; re-audit fan-out at ` +
  `"${REAUDIT_CRON}" ${REAUDIT_TIMEZONE}; alert dispatch at ` +
  `"${ALERT_DISPATCH_CRON}" ${ALERT_DISPATCH_TIMEZONE})`
)

const shutdown = (signal: string): void => {
  console.log(`${signal} received, shutting down`)

  // Before close(), which waits for in-flight jobs: a fan-out that has not
  // been told to stop would run to completion and blow through the grace
  // period below.
  reauditShutdown.abort()

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
      await Promise.all([reauditQueue.close(), alertQueue.close()])
      await closePageAuditor()
      await redis.close()
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
