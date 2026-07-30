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
 * How old an unfinished audit must be before the run will even ask whether it
 * has been abandoned.
 *
 * A filter, not a verdict. Age cannot tell an abandoned audit from one waiting
 * behind a long queue - on a queue that has not drained, every real pending
 * audit is old too - so the run confirms each candidate against the queue
 * before retiring it. What this number decides is how much gets examined.
 *
 * Twelve hours keeps it to rows that are past every legitimate reason to be
 * waiting on an ordinary night: the jitter window is six hours and the work is
 * done by 08:00 UTC. Being generous costs nothing but a slower reclaim, while
 * being aggressive costs a Redis round trip per healthy pending audit.
 */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000

/**
 * A ceiling on the fan-out itself, distinct from the shutdown grace.
 *
 * A run that has not finished in this long is not slow, it is stuck - and
 * because the handler holds a database connection and a queue for its whole
 * duration, a stuck one is worth ending. Retrying is safe: the eligibility
 * query excludes every page the attempt did schedule.
 */
export const REAUDIT_RUN_TIMEOUT_MS = 30 * 60 * 1000

/**
 * How long after its own deadline the run gets before it is stopped outright.
 *
 * The deadline above is a signal the run honours, so it stops at its next page
 * and returns a summary that can be logged. `runWithTimeout` rejects instead,
 * discarding whatever the handler returned - so a run bounded only by that
 * produces no record in exactly the case somebody most wants one.
 *
 * This margin is the room the cooperative stop needs to win: long enough for
 * the current page's insert and enqueue to finish, short enough that a run
 * ignoring its signal is still ended promptly.
 */
export const REAUDIT_HARD_STOP_MARGIN_MS = 60 * 1000

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
