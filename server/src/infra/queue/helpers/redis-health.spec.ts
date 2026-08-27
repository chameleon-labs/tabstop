import net from 'node:net';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {watchRedis} from './redis-health.js';

const connectionString = (): string => {
  const url = process.env.REDIS_URL;
  if (url === undefined) {
    throw new Error('REDIS_URL not set by globalSetup');
  }
  return url;
};

const UNREACHABLE = 'redis://127.0.0.1:1';

const reported = (): {lines: string[]; log: (message: string) => void} => {
  const lines: string[] = [];
  return {lines, log: (message) => lines.push(message)};
};

describe('watchRedis', () => {
  const open: {close: () => Promise<void>}[] = [];

  afterEach(async () => {
    for (const watcher of open.splice(0)) {
      await watcher.close();
    }
    vi.useRealTimers();
  });

  const watch = (url: string, log: (message: string) => void): {close: () => Promise<void>} => {
    const watcher = watchRedis(url, log);
    open.push(watcher);
    return watcher;
  };

  it('says so when it reaches Redis', async () => {
    const {lines, log} = reported();

    watch(connectionString(), log);

    await vi.waitFor(() => {
      expect(lines.join('\n')).toMatch(/Redis connected/);
    });
  });

  it('says so when it cannot reach Redis, rather than waiting in silence', async () => {
    const {lines, log} = reported();

    watch(UNREACHABLE, log);

    await vi.waitFor(() => {
      expect(lines.join('\n')).toMatch(/Redis unreachable/);
    });
  });

  it('reports the state once, however many times it retries', async () => {
    const {lines, log} = reported();

    watch(UNREACHABLE, log);
    await vi.waitFor(() => {
      expect(lines.length).toBeGreaterThan(0);
    });
    const afterFirst = lines.length;
    await new Promise((resolve) => {
      setTimeout(resolve, 600);
    });

    expect(lines.length).toBe(afterFirst);
  });

  it('names the address it could not reach', async () => {
    const {lines, log} = reported();

    watch(UNREACHABLE, log);

    await vi.waitFor(() => {
      expect(lines.join('\n')).toContain('127.0.0.1:1');
    });
  });

  it('reports a connection dropped cleanly, which raises no error at all', async () => {
    const {lines, log} = reported();
    const live = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      live.add(socket);
      socket.on('close', () => live.delete(socket));
      socket.end();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const {port} = server.address() as net.AddressInfo;

    const watcher = watch(`redis://127.0.0.1:${port}`, log);
    try {
      await vi.waitFor(() => {
        expect(lines.join('\n')).toMatch(/Redis unreachable/);
      });
    } finally {
      await watcher.close();
      for (const socket of live) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });

  it('names an IPv6 address in a form that can be pasted back', async () => {
    const {lines, log} = reported();

    watch('redis://[::1]:1', log);

    await vi.waitFor(() => {
      expect(lines.join('\n')).toContain('[::1]:1');
    });
  });

  it('says something rather than nothing when the URL names no host', async () => {
    const {lines, log} = reported();

    watch('unix:///nonexistent/redis.sock', log);

    await vi.waitFor(() => {
      expect(lines.join('\n')).toMatch(/Redis unreachable at the configured address/);
    });
  });

  it('reports recovery, so a queue that starts draining is explicable', async () => {
    const {lines, log} = reported();
    const watcher = watch(UNREACHABLE, log);
    await vi.waitFor(() => {
      expect(lines.join('\n')).toMatch(/Redis unreachable/);
    });
    await watcher.close();

    watch(connectionString(), log);

    await vi.waitFor(() => {
      expect(lines.join('\n')).toMatch(/Redis connected/);
    });
  });
});
