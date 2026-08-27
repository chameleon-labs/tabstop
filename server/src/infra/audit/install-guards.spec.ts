import {describe, expect, it, vi} from 'vitest';
import {installGuards, type GuardedContext} from './playwright-axe-auditor.js';
import {DISABLE_UNINTERCEPTED_TRANSPORTS} from './browser/disable-unintercepted-transports.js';
import type {RouteLike} from './request-guard.js';

const makeContext = () => ({
  addInitScript: vi.fn(async (_script: unknown) => {}),
  route: vi.fn(async (_pattern: string, _handler: (route: unknown) => unknown) => {}),
  routeWebSocket: vi.fn(async (_pattern: string, _handler: (ws: {close: () => void}) => void) => {}),
});

const noopGuard = async (_route: RouteLike): Promise<void> => {};

describe('installGuards', () => {
  it('intercepts every http request', async () => {
    const context = makeContext();

    await installGuards(context as unknown as GuardedContext, noopGuard);

    expect(context.route).toHaveBeenCalledWith('**/*', expect.any(Function));
  });

  it('also intercepts WebSockets, which context.route does not see', async () => {
    const context = makeContext();

    await installGuards(context as unknown as GuardedContext, noopGuard);

    expect(context.routeWebSocket).toHaveBeenCalledWith('**/*', expect.any(Function));
  });

  it('closes any socket a page opens rather than letting it connect', async () => {
    const context = makeContext();
    await installGuards(context as unknown as GuardedContext, noopGuard);
    const handler = context.routeWebSocket.mock.calls[0]?.[1];
    if (handler === undefined) {
      throw new Error('no WebSocket handler registered');
    }
    const socket = {close: vi.fn()};

    handler(socket);

    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('removes WebRTC before any page script runs', async () => {
    const context = makeContext();

    await installGuards(context as unknown as GuardedContext, noopGuard);

    expect(context.addInitScript).toHaveBeenCalledWith(DISABLE_UNINTERCEPTED_TRANSPORTS);
  });

  it('routes http requests through the guard it was given', async () => {
    const context = makeContext();
    const guard = vi.fn(async (_route: RouteLike) => {});

    await installGuards(context as unknown as GuardedContext, guard);
    const handler = context.route.mock.calls[0]?.[1];
    if (handler === undefined) {
      throw new Error('no route handler registered');
    }
    handler({marker: true});

    expect(guard).toHaveBeenCalledWith({marker: true});
  });
});
