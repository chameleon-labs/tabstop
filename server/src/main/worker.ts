import {UnrecoverableError} from 'bullmq';
import {env} from './config/env.js';
import {connectDatabase, disconnectDatabase, getDatabase} from './config/database.js';
import {
  QUEUE_NAMES,
  type AlertQueuePayload,
  type AuditPayload,
  type PingPayload,
  type ReauditPayload,
} from './config/queue-names.js';
import {
  makeQueue,
  makeWorker,
  rateLimitForAtLeast,
  setGlobalConcurrency,
  upsertDailySchedule,
} from '../infra/queue/helpers/bullmq-helper.js';
import {runWithTimeout} from '../infra/queue/run-with-timeout.js';
import {watchRedis} from '../infra/queue/helpers/redis-health.js';
import {PermanentAuditError} from '../domain/errors/permanent-audit-error.js';
import {closePageAuditor, makeRunAudit} from './factories/usecases/run-audit/run-audit-factory.js';
import {PostgresSessionRepository} from '../infra/db/postgres/session/postgres-session-repository.js';
import {startSessionSweeper} from './maintenance/session-sweeper.js';
import {
  REAUDIT_ATTEMPTS,
  REAUDIT_CRON,
  REAUDIT_HARD_STOP_MARGIN_MS,
  REAUDIT_RETRY_BACKOFF_MS,
  REAUDIT_RUN_TIMEOUT_MS,
  REAUDIT_SCHEDULER_ID,
  REAUDIT_TIMEZONE,
} from './config/reaudit.js';
import {makeRunScheduledReaudits} from './factories/usecases/reaudit/reaudit-factory.js';
import type {ReauditRunSummary} from '../domain/usecases/run-scheduled-reaudits.js';
import {reauditRunFailure} from './jobs/reaudit-job-outcome.js';
import {ALERT_DISPATCH_CRON, ALERT_DISPATCH_TIMEZONE} from './config/alert-email.js';
import {
  makeDispatchPendingAlertEmails,
  makeSendAlertEmail,
} from './factories/usecases/alert/alert-worker-usecase-factories.js';
import {registerAlertEmailDispatcher} from './jobs/alert-email-scheduler.js';
import {ALERT_EMAIL_WORKER_LIMITER, makeAlertEmailJobProcessor} from './jobs/alert-email-job-processor.js';

const PING_TIMEOUT_MS = 10_000;

connectDatabase(env.databaseUrl);

const redis = watchRedis(env.redisUrl, console.log);

const pingWorker = makeWorker<PingPayload>(QUEUE_NAMES.ping, env.redisUrl, async (job) => {
  await runWithTimeout(PING_TIMEOUT_MS, () => {
    console.log(`ping received, requested at ${job.data.requestedAt}`);
    return Promise.resolve();
  });
});

await setGlobalConcurrency(QUEUE_NAMES.audit, env.redisUrl, env.auditConcurrency);

const auditWorker = makeWorker<AuditPayload>(
  QUEUE_NAMES.audit,
  env.redisUrl,
  async (job) => {
    await runWithTimeout(env.auditJobTimeoutMs, async (signal) => {
      const attempts = job.opts.attempts ?? 1;

      try {
        await makeRunAudit().run({
          auditId: job.data.auditId,
          signal,
          isFinalAttempt: job.attemptsMade >= attempts - 1,
        });
      } catch (error) {
        if (error instanceof PermanentAuditError) {
          throw new UnrecoverableError(error.message);
        }
        throw error;
      }
    });
  },
  {
    concurrency: env.auditConcurrency,
    lockDuration: env.auditJobTimeoutMs + 15_000,
  },
);

const reauditQueue = makeQueue<ReauditPayload>(QUEUE_NAMES.reaudit, env.redisUrl);

reauditQueue.on('error', (error) => {
  console.error('Re-audit queue error (Redis connection):', error);
});

await upsertDailySchedule(reauditQueue, REAUDIT_SCHEDULER_ID, REAUDIT_CRON, REAUDIT_TIMEZONE, {
  attempts: REAUDIT_ATTEMPTS,
  backoff: {type: 'exponential', delay: REAUDIT_RETRY_BACKOFF_MS},
});

const reauditShutdown = new AbortController();

const reauditWorker = makeWorker<ReauditPayload>(QUEUE_NAMES.reaudit, env.redisUrl, async (job) => {
  const startedAt = Date.now();

  const softDeadline = AbortSignal.timeout(REAUDIT_RUN_TIMEOUT_MS);

  let progress: ReauditRunSummary | null = null;

  const summary = await runWithTimeout(REAUDIT_RUN_TIMEOUT_MS + REAUDIT_HARD_STOP_MARGIN_MS, async (hardStop) => {
    const stop = AbortSignal.any([softDeadline, hardStop, reauditShutdown.signal]);
    return await makeRunScheduledReaudits().run(new Date(), {
      signal: stop,
      report: (partial) => {
        progress = partial;
      },
    });
  }).catch((error: unknown) => {
    console.log(
      JSON.stringify({
        event: 'reaudit-run',
        outcome: 'aborted',
        ...progress,
        reason: error instanceof Error ? error.message : String(error),
        attempt: job.attemptsMade + 1,
        durationMs: Date.now() - startedAt,
      }),
    );
    throw error;
  });

  console.log(
    JSON.stringify({
      event: 'reaudit-run',
      outcome: 'completed',
      ...summary,
      attempt: job.attemptsMade + 1,
      durationMs: Date.now() - startedAt,
    }),
  );

  const failure = reauditRunFailure(summary, reauditShutdown.signal.aborted);
  if (failure !== null) {
    throw new Error(failure);
  }
});

const alertQueue = makeQueue<AlertQueuePayload>(QUEUE_NAMES.alertEmail, env.redisUrl);
alertQueue.on('error', (error) => {
  console.error('Alert email queue error (Redis connection):', error);
});

await registerAlertEmailDispatcher(alertQueue);

const dispatchPendingAlertEmails = makeDispatchPendingAlertEmails(alertQueue);
const sendAlertEmail = makeSendAlertEmail();
const alertWorker = makeWorker<AlertQueuePayload>(
  QUEUE_NAMES.alertEmail,
  env.redisUrl,
  makeAlertEmailJobProcessor({
    rateLimit: async (durationMs) => {
      await rateLimitForAtLeast(alertQueue, durationMs);
    },
    dispatch: dispatchPendingAlertEmails.dispatch.bind(dispatchPendingAlertEmails),
    send: sendAlertEmail.send.bind(sendAlertEmail),
  }),
  {limiter: ALERT_EMAIL_WORKER_LIMITER},
);

const sessionSweeper = startSessionSweeper(new PostgresSessionRepository(getDatabase()));

const workers = [pingWorker, auditWorker, reauditWorker, alertWorker];

for (const worker of workers) {
  worker.on('failed', (job, error) => {
    console.error(`Job ${job?.id ?? 'unknown'} failed:`, error);
  });

  worker.on('error', (error) => {
    console.error('Worker error (connection or lock renewal):', error);
  });
}

await Promise.all(
  workers.map(async (worker) => {
    await worker.waitUntilReady();
  }),
);
console.log(
  `Worker started, consuming "${QUEUE_NAMES.ping}", "${QUEUE_NAMES.audit}" and ` +
    `"${QUEUE_NAMES.reaudit}", and "${QUEUE_NAMES.alertEmail}" ` +
    `(audit concurrency ${env.auditConcurrency}, enforced across all workers; re-audit fan-out at ` +
    `"${REAUDIT_CRON}" ${REAUDIT_TIMEZONE}; alert dispatch at ` +
    `"${ALERT_DISPATCH_CRON}" ${ALERT_DISPATCH_TIMEZONE})`,
);

const shutdown = (signal: string): void => {
  console.log(`${signal} received, shutting down`);

  reauditShutdown.abort();

  const forceExit = setTimeout(() => {
    console.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, env.auditJobTimeoutMs + 30_000);
  forceExit.unref();

  void Promise.all(
    workers.map(async (worker) => {
      await worker.close();
    }),
  )
    .then(async () => {
      sessionSweeper.stop();
      await Promise.all([reauditQueue.close(), alertQueue.close()]);
      await closePageAuditor();
      await redis.close();
      await disconnectDatabase();
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('Error closing the worker:', error);
      process.exit(1);
    });
};

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
