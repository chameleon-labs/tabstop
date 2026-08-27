import express from 'express';
import type {Server} from 'node:http';
import {afterEach, describe, expect, it} from 'vitest';
import {startListening} from './listen.js';

const reports = (): {lines: string[]; fatal: string[]; handlers: Parameters<typeof startListening>[2]} => {
  const lines: string[] = [];
  const fatal: string[] = [];
  return {lines, fatal, handlers: {info: (m) => lines.push(m), fatal: (m) => fatal.push(m)}};
};

const settled = async (server: Server): Promise<Server> =>
  await new Promise((resolve) => {
    server.once('listening', () => {
      resolve(server);
    });
    server.once('error', () => {
      resolve(server);
    });
  });

const portOf = (server: Server): number => {
  const address = server.address();
  return address !== null && typeof address !== 'string' ? address.port : 0;
};

describe('startListening', () => {
  const open: Server[] = [];

  afterEach(async () => {
    for (const server of open.splice(0)) {
      await new Promise((resolve) => {
        server.close(() => {
          resolve(null);
        });
      });
    }
  });

  const listen = (port: number, handlers: Parameters<typeof startListening>[2]): Server => {
    const server = startListening(express(), port, handlers);
    open.push(server);
    return server;
  };

  const takenPort = async (): Promise<number> => portOf(await settled(listen(0, reports().handlers)));

  it('says it is running once it is', async () => {
    const {lines, handlers} = reports();

    await settled(listen(0, handlers));

    expect(lines.join('\n')).toMatch(/Server running/);
  });

  it('names the address it actually bound, not the one it was asked for', async () => {
    const {lines, handlers} = reports();

    const port = portOf(await settled(listen(0, handlers)));

    expect(port).toBeGreaterThan(0);
    expect(lines.join('\n')).toContain(String(port));
  });

  it('does not claim to be running when the bind failed', async () => {
    const port = await takenPort();

    const second = reports();
    await settled(listen(port, second.handlers));

    expect(second.lines.join('\n')).not.toMatch(/Server running/);
  });

  it('reports the conflict, and names the port so it can be freed', async () => {
    const port = await takenPort();

    const second = reports();
    await settled(listen(port, second.handlers));

    expect(second.fatal.join('\n')).toMatch(/EADDRINUSE|already in use/i);
    expect(second.fatal.join('\n')).toContain(String(port));
  });

  it('treats a failed bind as fatal, so a supervisor learns what the log says', async () => {
    const port = await takenPort();

    const second = reports();
    await settled(listen(port, second.handlers));

    expect(second.fatal).toHaveLength(1);
  });
});
