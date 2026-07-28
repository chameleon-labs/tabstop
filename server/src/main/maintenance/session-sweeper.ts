import type {
  DeleteExpiredSessionsRepository
} from '../../data/protocols/db/session/delete-expired-sessions-repository.js'

/**
 * Hourly. Sessions live for 30 days by default, so nothing here is urgent -
 * the point is that the table stops growing without bound, not that a row
 * disappears the instant it expires. A long interval also keeps the sweep off
 * the critical path of anything a user is waiting for.
 */
export const SWEEP_INTERVAL_MS = 3_600_000

export type Sweeper = { stop: () => void }

/**
 * Runs in the WORKER, not the API.
 *
 * The API scales horizontally, so putting this there would mean N instances
 * running the same DELETE on the same rows every hour - harmless, since the
 * statement is idempotent and scoped by the database's own clock, but wasteful
 * and hard to reason about. The worker is the process that already owns
 * background work and already holds a database connection.
 *
 * Deliberately NOT a BullMQ repeatable job: that would make session
 * maintenance depend on Redis being healthy, and the point of #10's design is
 * that authentication does not. A timer needs nothing but the process.
 */
export const startSessionSweeper = (
  sessions: DeleteExpiredSessionsRepository,
  intervalMs: number = SWEEP_INTERVAL_MS
): Sweeper => {
  const sweep = async (): Promise<void> => {
    try {
      const removed = await sessions.deleteExpired()
      // Logged even at zero. A maintenance task that only speaks up when it
      // finds something is one nobody notices has stopped running.
      console.log(`Session sweep removed ${removed} expired session(s)`)
    } catch (error) {
      // Never fatal. Failing to tidy up is not a reason to take the worker
      // down, and the next pass will find the same rows still waiting.
      console.error('Session sweep failed:', error)
    }
  }

  // Not on boot: a worker restarting in a crash loop would otherwise issue a
  // table-wide delete on every start, which is exactly when the database is
  // least likely to want one.
  const timer = setInterval(() => { void sweep() }, intervalMs)
  // So a pending sweep can never hold the process open during shutdown.
  timer.unref()

  return { stop: () => { clearInterval(timer) } }
}
