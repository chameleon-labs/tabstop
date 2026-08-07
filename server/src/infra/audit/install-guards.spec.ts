import {describe, expect, it, vi} from 'vitest';
import {installGuards, type GuardedContext} from './playwright-axe-auditor.js';
import {DISABLE_UNINTERCEPTED_TRANSPORTS} from './browser/disable-unintercepted-transports.js';
import type {RouteLike} from './request-guard.js';

/**
 * A test double, cast because Playwright's BrowserContext is far too large to
 * implement and this only exercises two of its methods. Confining the cast to
 * a double keeps it out of anything that ships.
 */
const makeContext = () => ({
  addInitScript: vi.fn(async (_script: unknown) => {
    /* no-op */
  }),
  route: vi.fn(async (_pattern: string, _handler: (route: unknown) => unknown) => {
    /* no-op */
  }),
  routeWebSocket: vi.fn(async (_pattern: string, _handler: (ws: {close: () => void}) => void) => {
    /* no-op */
  }),
});

const noopGuard = async (_route: RouteLike): Promise<void> => {
  /* no-op */
};

describe('installGuards', () => {
  it('intercepts every http request', async () => {
    const context = makeContext();

    await installGuards(context as unknown as GuardedContext, noopGuard);

    expect(context.route).toHaveBeenCalledWith('**/*', expect.any(Function));
  });

  it('also intercepts WebSockets, which context.route does not see', async () => {
    // The regression this pins: without a WebSocket registration an audited
    // page can open ws://10.0.0.5/ and reach past every address and scheme
    // check, because context.route never fires for a socket.
    const context = makeContext();

    await installGuards(context as unknown as GuardedContext, noopGuard);

    expect(context.routeWebSocket).toHaveBeenCalledWith('**/*', expect.any(Function));
  });

  it('closes any socket a page opens rather than letting it connect', async () => {
    const context = makeContext();
    await installGuards(context as unknown as GuardedContext, noopGuard);
    const handler = context.routeWebSocket.mock.calls[0]?.[1];
    if (handler === undefined) throw new Error('no WebSocket handler registered');
    const socket = {close: vi.fn()};

    handler(socket);

    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('removes WebRTC before any page script runs', async () => {
    // WebRTC is intercepted by neither route nor routeWebSocket, needs no
    // permission for a data channel, and will send packets to whatever ICE
    // candidate address a page supplies - a direct path to an internal host
    // past every check the guard performs.
    const context = makeContext();

    await installGuards(context as unknown as GuardedContext, noopGuard);

    expect(context.addInitScript).toHaveBeenCalledWith(DISABLE_UNINTERCEPTED_TRANSPORTS);
  });

  it('routes http requests through the guard it was given', async () => {
    const context = makeContext();
    const guard = vi.fn(async (_route: RouteLike) => {
      /* no-op */
    });

    await installGuards(context as unknown as GuardedContext, guard);
    const handler = context.route.mock.calls[0]?.[1];
    if (handler === undefined) throw new Error('no route handler registered');
    handler({marker: true});

    expect(guard).toHaveBeenCalledWith({marker: true});
  });
});
