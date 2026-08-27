export class JobTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Job exceeded its ${timeoutMs}ms timeout`);
    this.name = 'JobTimeoutError';
  }
}

export const JOB_UNWIND_GRACE_MS = 15_000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });

export const runWithTimeout = async <T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
  unwindGraceMs: number = JOB_UNWIND_GRACE_MS,
): Promise<T> => {
  const controller = new AbortController();
  const cleanup = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const work = run(controller.signal);
  const settled = work.then(
    () => undefined,
    () => undefined,
  );

  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => {
            reject(new JobTimeoutError(timeoutMs));
          },
          {signal: cleanup.signal},
        );
      }),
    ]);
  } catch (error) {
    if (!timedOut) {
      throw error;
    }

    await Promise.race([settled, delay(unwindGraceMs)]);
    throw new JobTimeoutError(timeoutMs);
  } finally {
    clearTimeout(timer);
    cleanup.abort();
  }
};
