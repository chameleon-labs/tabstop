import {describe, expect, it, vi} from 'vitest';
import {JobTimeoutError, runWithTimeout} from './run-with-timeout.js';

// A handler that hangs forever. Simulating one with a long sleep would leave a
// live timer behind after the timeout wins the race, and make the suite wait
// out a delay that proves nothing.
const hangs = async (): Promise<never> =>
  await new Promise(() => {
    /* never settles */
  });

// A handler that ignores its abort signal makes runWithTimeout wait out the
// unwind grace before reporting, which is the point of the grace but would
// otherwise add its full default to the suite. Specs using `hangs` pass a
// short one explicitly.
const SHORT_GRACE_MS = 50;

describe('runWithTimeout', () => {
  it('resolves with the handler result when it finishes in time', async () => {
    const result = await runWithTimeout(1000, () => Promise.resolve('done'));

    expect(result).toBe('done');
  });

  it('rejects with JobTimeoutError when the handler runs over budget', async () => {
    await expect(runWithTimeout(20, hangs, SHORT_GRACE_MS)).rejects.toBeInstanceOf(JobTimeoutError);
  });

  it('aborts the signal it handed the handler, so the handler can stop its own work', async () => {
    let observed: boolean | null = null;

    await expect(
      // Waiting on the abort event rather than a fixed delay also proves the
      // handler's own listener survives runWithTimeout's cleanup.
      runWithTimeout(
        20,
        async (signal) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener(
              'abort',
              () => {
                resolve();
              },
              {once: true},
            );
          });
          observed = signal.aborted;
        },
        SHORT_GRACE_MS,
      ),
    ).rejects.toBeInstanceOf(JobTimeoutError);

    await vi.waitFor(
      () => {
        expect(observed).toBe(true);
      },
      {timeout: 5000},
    );
  });

  it('propagates a handler error unchanged', async () => {
    await expect(runWithTimeout(1000, () => Promise.reject(new Error('handler blew up')))).rejects.toThrow(
      'handler blew up',
    );
  });

  it('does not abort the signal when the handler finishes in time', async () => {
    let observed: boolean | null = null;

    await runWithTimeout(1000, (signal) => {
      observed = signal.aborted;
      return Promise.resolve();
    });

    expect(observed).toBe(false);
  });

  it('waits for the handler to finish unwinding before reporting the timeout', async () => {
    // Settling the moment the signal fires would let BullMQ start the next
    // attempt while this one is still writing - a late write from the
    // abandoned attempt then lands on top of the retry.
    const order: string[] = [];

    const failure = await runWithTimeout(
      20,
      async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              setTimeout(() => {
                order.push('handler unwound');
                resolve();
              }, 40);
            },
            {once: true},
          );
        });
        throw new Error('aborted');
      },
      5_000,
    ).catch((error: unknown) => error);

    order.push('timeout reported');

    expect(failure).toBeInstanceOf(JobTimeoutError);
    expect(order).toEqual(['handler unwound', 'timeout reported']);
  });

  it('gives up on a handler that ignores its signal, rather than stalling', async () => {
    const started = Date.now();

    const failure = await runWithTimeout(20, hangs, SHORT_GRACE_MS).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(JobTimeoutError);
    // Bounded by the grace, not by the handler.
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('reports the timeout even when the handler rejects with its own error', async () => {
    // The abandoned attempt's own "context closed" noise must not replace the
    // reason the job actually ended.
    const failure = await runWithTimeout(
      20,
      async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve();
            },
            {once: true},
          );
        });
        throw new Error('browser context was closed');
      },
      5_000,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(JobTimeoutError);
  });
});
