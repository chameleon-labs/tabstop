/** The scheduler's identity in Redis. Upserting on it updates in place. */
export const REAUDIT_SCHEDULER_ID = 'daily-reaudit'

/**
 * 02:00 UTC. Quiet for most of the world, and far enough from midnight that a
 * run which slips still lands on the day it was scheduled for.
 *
 * UTC, and documented as such. "Daily in the user's timezone" is a per-user
 * schedule, which #13 puts out of scope for v1 - so "every 24h in UTC" is the
 * honest promise, and the one the day-boundary dedupe already assumes.
 */
export const REAUDIT_CRON = '0 2 * * *'
export const REAUDIT_TIMEZONE = 'UTC'

/**
 * How many pages one query of the worklist returns. A memory bound only - the
 * run pages through until the batches run out, so this decides how much is
 * held at once, never how many pages get monitored.
 */
export const REAUDIT_BATCH_SIZE = 500

/**
 * A circuit breaker on one run, not a cap on the product.
 *
 * The run pages, so this is not the "everything past here goes unaudited"
 * limit an unpaged version needed - it exists so a bug in the eligibility
 * predicate cannot turn one night into an unbounded loop over the pages table.
 * A run that reaches it reports `truncated`, which is an alert rather than a
 * routine outcome.
 */
export const MAX_PAGES_PER_RUN = 50_000

/**
 * How long an unfinished audit still counts as work in progress.
 *
 * Derived, not chosen. It has to exceed the longest a legitimately queued
 * audit can sit before running - the six-hour jitter window, plus the job
 * budget, plus its retries - or the run would treat its own scheduled work as
 * abandoned and schedule it twice. And it has to stay well under the 24-hour
 * cadence, or an abandoned row survives to hide its page from the next run,
 * which is the failure this bound exists to prevent.
 *
 * Twelve hours sits between the two with room on both sides: the night's work
 * is finished by 08:00 UTC, and the next run is at 02:00.
 */
export const IN_FLIGHT_GRACE_MS = 12 * 60 * 60 * 1000

/**
 * A minute, then two, rather than the queue-wide one second.
 *
 * The fan-out's failures are almost always a database or Redis blip, and a
 * second is not long enough for either to pass. Retrying is safe: the
 * eligibility query excludes every page the first attempt did schedule, so an
 * attempt after a partial run picks up only what is still owed.
 */
export const REAUDIT_RETRY_BACKOFF_MS = 60_000
export const REAUDIT_ATTEMPTS = 3
