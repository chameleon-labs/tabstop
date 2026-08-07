import express from 'express';
import type {Server} from 'node:http';
import {afterEach, describe, expect, it} from 'vitest';
import {startListening} from './listen.js';

/**
 * Two servers, one port, in one process.
 *
 * The bug was found with another application holding 3000 and again with a
 * `tsx watch` reload racing itself, but a spec must not depend on either. Two
 * listeners in one test reproduce the same `EADDRINUSE` with nothing external.
 */
const reports = (): {lines: string[]; fatal: string[]; handlers: Parameters<typeof startListening>[2]} => {
  const lines: string[] = [];
  const fatal: string[] = [];
  return {lines, fatal, handlers: {info: (m) => lines.push(m), fatal: (m) => fatal.push(m)}};
};

/**
 * Resolves once the server has either bound or failed to - whichever happens.
 *
 * The events rather than a fixed delay, so a slow machine cannot turn a pass
 * into a failure and a fast one does not pay for the wait. BOTH outcomes
 * resolve because half of these tests are about the failing path, and a helper
 * that only knew about success would have to be raced against a timer again to
 * be usable there.
 *
 * The production handlers have already run when this resolves: `startListening`
 * registers its own listeners first, and listeners fire in registration order.
 *
 * NOT gated on `server.listening`, which is the trap here. It is true
 * SYNCHRONOUSLY once the bind succeeds, while the listen callback does not run
 * until the next tick - so a `listening` short-circuit resolves before the
 * handler under test has said anything, and the success cases fail on an empty
 * log. Must therefore be called in the same tick as `listen`, which is the only
 * way it is used: later, the event would already have been missed.
 */
const settled = async (server: Server): Promise<Server> =>
  await new Promise((resolve) => {
    server.once('listening', () => {
      resolve(server);
    });
    server.once('error', () => {
      resolve(server);
    });
  });

/** The port a server actually bound, or 0 if it never did. */
const portOf = (server: Server): number => {
  const address = server.address();
  return address !== null && typeof address !== 'string' ? address.port : 0;
};

describe('startListening', () => {
  const open: Server[] = [];

  afterEach(async () => {
    for (const server of open.splice(0)) {
      // The callback's error argument is ignored on purpose: servers that never
      // bound are in here too, and closing one of those calls back with
      // ERR_SERVER_NOT_RUNNING rather than throwing or emitting anything.
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
    // Port 0 is the clearest case: what the caller asked for is never what it
    // got, so a line built from the requested port is provably wrong.
    const {lines, handlers} = reports();

    const port = portOf(await settled(listen(0, handlers)));

    expect(port).toBeGreaterThan(0);
    expect(lines.join('\n')).toContain(String(port));
  });

  it('does not claim to be running when the bind failed', async () => {
    // The defect. Express 5 runs the listen callback even when the bind failed
    // - `listening` is false and `address()` is null - so the one line a reader
    // uses to know the server is up was printed on the path where it is down.
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
    // Nothing exits today, which is why the failure is invisible: the process
    // stays alive holding no socket and `--kill-others` sees no exit.
    const port = await takenPort();

    const second = reports();
    await settled(listen(port, second.handlers));

    expect(second.fatal).toHaveLength(1);
  });
});
