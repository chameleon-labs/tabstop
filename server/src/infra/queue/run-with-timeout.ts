export class JobTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Job exceeded its ${timeoutMs}ms timeout`);
    this.name = 'JobTimeoutError';
  }
}

/**
 * Ample for closing a browser context and finishing one status write.
 *
 * Exported because anything that must outlast an attempt has to be derived
 * from it: an attempt can occupy its job budget PLUS this grace, and a lease
 * shorter than that sum would let a second worker reclaim work still running.
 */
export const JOB_UNWIND_GRACE_MS = 15_000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    // unref'd so a pending grace timer can never hold the process open.
    setTimeout(resolve, ms).unref();
  });

/**
 * BullMQ has no per-job timeout - neither WorkerOptions nor JobsOptions
 * provides one - so handlers that can hang need this wrapper.
 *
 * The signal is passed INTO the handler rather than merely raced around it.
 * Racing alone rejects this promise while the handler's work carries on
 * unattended; for a browser-driving job that would leave a live Chromium
 * process behind. Honouring the signal is the handler's job, and this is
 * what makes that possible.
 *
 * Aborting is not sufficient on its own, though, because unwinding takes time.
 * If this settled the moment the signal fired, BullMQ would be free to start
 * the next attempt - and shutdown free to close the shared browser and the
 * database - while the previous attempt was still closing its context and
 * writing its status. A late write from the abandoned attempt would then land
 * on top of the retry, or fail against a closed pool. So after aborting, this
 * waits for the handler to finish unwinding before reporting the timeout,
 * bounded by a grace period so a handler that ignores its signal cannot stall
 * the worker indefinitely.
 */
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
  // Attached immediately and never removed, so a rejection arriving after the
  // race has settled is always handled rather than becoming an unhandled
  // rejection. This is also what the grace period below waits on.
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
    if (!timedOut) throw error;

    // Report the timeout only once the handler has stopped working - or the
    // grace has run out, which means it is ignoring its signal and waiting
    // longer would only stall the worker.
    await Promise.race([settled, delay(unwindGraceMs)]);
    throw new JobTimeoutError(timeoutMs);
  } finally {
    clearTimeout(timer);
    // A handler that outlives the race may keep the signal we handed it.
    // Detaching our listener stops that retention from also pinning this
    // promise's reject closure.
    cleanup.abort();
  }
};
