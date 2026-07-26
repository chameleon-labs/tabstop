import { env } from './config/env.js'
import { QUEUE_NAMES, type PingPayload } from './config/queue-names.js'
import { makeWorker } from '../infra/queue/helpers/bullmq-helper.js'
import { runWithTimeout } from '../infra/queue/run-with-timeout.js'

const PING_TIMEOUT_MS = 10_000

const worker = makeWorker<PingPayload>(QUEUE_NAMES.ping, env.redisUrl, async (job) => {
  // The signal is intentionally unused: this handler has nothing to abort.
  // Handlers that do real work - the audit job especially - must accept it
  // and pass it down, or a timed-out job leaves its work running.
  await runWithTimeout(PING_TIMEOUT_MS, async () => {
    console.log(`ping received, requested at ${job.data.requestedAt}`)
  })
})

worker.on('failed', (job, error) => {
  console.error(`Job ${job?.id ?? 'unknown'} failed:`, error)
})

worker.on('error', (error) => {
  console.error('Worker error (connection or lock renewal):', error)
})

await worker.waitUntilReady()
console.log(`Worker started, consuming "${QUEUE_NAMES.ping}"`)

const shutdown = (signal: string): void => {
  console.log(`${signal} received, shutting down`)

  // Must stay greater than the longest per-job timeout, or a SIGTERM arriving
  // mid-job force-exits before the job can finish. Ping's budget is 10s; the
  // audit job will need this raised when it lands.
  const forceExit = setTimeout(() => {
    console.error('Shutdown timed out, forcing exit')
    process.exit(1)
  }, 30_000)
  forceExit.unref()

  // close() waits for the in-flight job to finish rather than dropping it.
  void worker.close()
    .then(() => { process.exit(0) })
    .catch((error: unknown) => {
      // Exit non-zero so a supervisor can distinguish a failed teardown from a
      // clean one - matching server.ts and the force-exit path above.
      console.error('Error closing the worker:', error)
      process.exit(1)
    })
}

process.on('SIGTERM', () => { shutdown('SIGTERM') })
process.on('SIGINT', () => { shutdown('SIGINT') })
