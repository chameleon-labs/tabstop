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

  let timer: NodeJS.Timeout | null = null
  let stopped = false

  // setTimeout re-armed after the sweep SETTLES, not setInterval.
  //
  // setInterval fires on a fixed cadence regardless of whether the previous
  // callback finished, and this callback is async - so a delete that outlasts
  // the interval, which is exactly what a table big enough to need sweeping
  // plus lock contention produces, would have a second delete start on top of
  // it, then a third. Each holds a pool connection, and the pool is the same
  // one the audit jobs need. Re-arming afterwards makes at most one
  // maintenance query possible at a time, and costs only that the period
  // becomes "an hour after the last one finished" rather than "on the hour" -
  // which for a cleanup task is the more useful of the two.
  const schedule = (): void => {
    if (stopped) return
    timer = setTimeout(() => { void run() }, intervalMs)
    // So a pending sweep can never hold the process open during shutdown.
    timer.unref()
  }

  const run = async (): Promise<void> => {
    try {
      await sweep()
    } finally {
      schedule()
    }
  }

  // Not on boot: a worker restarting in a crash loop would otherwise issue a
  // table-wide delete on every start, which is exactly when the database is
  // least likely to want one.
  schedule()

  return {
    stop: () => {
      stopped = true
      if (timer !== null) clearTimeout(timer)
    }
  }
}
