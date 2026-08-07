/** The scheduler's identity in Redis. Upserting on it updates in place. */
export const REAUDIT_SCHEDULER_ID = 'daily-reaudit';

/**
 * 02:00 UTC. Quiet for most of the world, and far enough from midnight that a
 * run which slips still lands on the day it was scheduled for.
 *
 * UTC deliberately: "daily in the user's timezone" is a per-user schedule, out
 * of scope for v1 (#13), and the day-boundary dedupe already assumes this.
 */
export const REAUDIT_CRON = '0 2 * * *';
export const REAUDIT_TIMEZONE = 'UTC';

/**
 * How many pages one query of the worklist returns. A memory bound only - the
 * run pages until the batches run out, so this never limits how many pages get
 * monitored.
 */
export const REAUDIT_BATCH_SIZE = 500;

/**
 * A circuit breaker on one run, not a cap on the product.
 *
 * It exists so a bug in the eligibility predicate cannot turn one night into an
 * unbounded loop over the pages table. A run that reaches it reports
 * `truncated`, which is an alert rather than a routine outcome.
 */
export const MAX_PAGES_PER_RUN = 50_000;

/**
 * How old an unfinished audit must be before the run asks whether it has been
 * abandoned.
 *
 * A filter, not a verdict: age cannot tell an abandoned audit from one behind a
 * long queue, so each candidate is confirmed against the queue before being
 * retired. Twelve hours clears every legitimate reason to be waiting - the
 * jitter window is six hours and the work is done by 08:00 UTC - and being
 * generous costs only a slower reclaim, whereas being aggressive costs a Redis
 * round trip per healthy pending audit.
 */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * A ceiling on the fan-out itself, distinct from the shutdown grace.
 *
 * A run this long is stuck rather than slow, and it holds a database connection
 * and a queue throughout. Retrying is safe: the eligibility query excludes
 * every page the attempt did schedule.
 */
export const REAUDIT_RUN_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * How long after its own deadline the run gets before it is stopped outright.
 *
 * The deadline above is a signal the run honours, so it stops at its next page
 * and returns a loggable summary. `runWithTimeout` rejects instead, discarding
 * whatever the handler returned - producing no record in exactly the case
 * somebody most wants one. This margin is the room the cooperative stop needs
 * to win.
 */
export const REAUDIT_HARD_STOP_MARGIN_MS = 60 * 1000;

/**
 * A minute, then two, rather than the queue-wide one second: these failures are
 * almost always a database or Redis blip, and a second is not long enough for
 * either to pass. Safe to retry, since the eligibility query excludes every
 * page the first attempt scheduled.
 */
export const REAUDIT_RETRY_BACKOFF_MS = 60_000;
export const REAUDIT_ATTEMPTS = 3;
