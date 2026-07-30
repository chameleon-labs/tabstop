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
 * A ceiling on one fan-out, not a policy. v1 caps an account at ten pages so
 * nothing is remotely near this - but a scheduler whose memory use is however
 * many rows matched is one that fails on the night the product succeeds.
 *
 * If it ever truncates, the same tail is cut every night, so the run reports
 * `truncated` and that is an operational alert rather than a routine outcome.
 */
export const MAX_PAGES_PER_RUN = 5000

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
