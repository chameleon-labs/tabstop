import {REAUDIT_RUN_HOUR_UTC} from '../../domain/services/reaudit-schedule.js';

export const REAUDIT_SCHEDULER_ID = 'daily-reaudit';

export const REAUDIT_CRON = `0 ${REAUDIT_RUN_HOUR_UTC} * * *`;
export const REAUDIT_TIMEZONE = 'UTC';

export const REAUDIT_BATCH_SIZE = 500;

export const MAX_PAGES_PER_RUN = 50_000;

export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export const REAUDIT_RUN_TIMEOUT_MS = 30 * 60 * 1000;

export const REAUDIT_HARD_STOP_MARGIN_MS = 60 * 1000;

export const REAUDIT_RETRY_BACKOFF_MS = 60_000;
export const REAUDIT_ATTEMPTS = 3;
