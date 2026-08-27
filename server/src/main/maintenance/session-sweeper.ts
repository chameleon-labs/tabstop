import type {DeleteExpiredSessionsRepository} from '../../data/protocols/db/session/delete-expired-sessions-repository.js';

export const SWEEP_INTERVAL_MS = 3_600_000;

export type Sweeper = {stop: () => void};

export const startSessionSweeper = (
  sessions: DeleteExpiredSessionsRepository,
  intervalMs: number = SWEEP_INTERVAL_MS,
): Sweeper => {
  const sweep = async (): Promise<void> => {
    try {
      const removed = await sessions.deleteExpired();
      console.log(`Session sweep removed ${removed} expired session(s)`);
    } catch (error) {
      console.error('Session sweep failed:', error);
    }
  };

  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const schedule = (): void => {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      void run();
    }, intervalMs);
    timer.unref();
  };

  const run = async (): Promise<void> => {
    try {
      await sweep();
    } finally {
      schedule();
    }
  };

  schedule();

  return {
    stop: () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    },
  };
};
