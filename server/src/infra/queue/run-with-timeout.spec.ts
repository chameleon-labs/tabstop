import {describe, expect, it, vi} from 'vitest';
import {JobTimeoutError, runWithTimeout} from './run-with-timeout.js';

const hangs = async (): Promise<never> => await new Promise(() => {});

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
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('reports the timeout even when the handler rejects with its own error', async () => {
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
