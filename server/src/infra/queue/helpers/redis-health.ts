import {Redis} from 'ioredis';

export type RedisWatcher = {
  close: () => Promise<void>;
};

export type ReportLine = (message: string) => void;

const UNNAMED = 'the configured address';

const addressOf = (url: string): string => {
  try {
    const {host} = new URL(url);
    return host === '' ? UNNAMED : host;
  } catch {
    return UNNAMED;
  }
};

export const watchRedis = (url: string, report: ReportLine): RedisWatcher => {
  const address = addressOf(url);
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });

  let reachable: boolean | null = null;

  const transition = (next: boolean, message: string): void => {
    if (reachable === next) {
      return;
    }
    reachable = next;
    report(message);
  };

  const down = (reason: string): void => {
    transition(false, `Redis unreachable at ${address} - retrying (${reason})`);
  };

  client.on('ready', () => {
    transition(true, `Redis connected at ${address}`);
  });
  client.on('error', (error: Error) => {
    down(error.message);
  });
  client.on('close', () => {
    down('connection closed');
  });

  return {
    close: () => {
      client.removeAllListeners();
      client.disconnect();
      return Promise.resolve();
    },
  };
};
