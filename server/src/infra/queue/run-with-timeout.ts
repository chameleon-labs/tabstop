export class JobTimeoutError extends Error {
  constructor (timeoutMs: number) {
    super(`Job exceeded its ${timeoutMs}ms timeout`)
    this.name = 'JobTimeoutError'
  }
}

/**
 * BullMQ has no per-job timeout - neither WorkerOptions nor JobsOptions
 * provides one - so handlers that can hang need this wrapper.
 *
 * The signal is passed INTO the handler rather than merely raced around it.
 * Racing alone rejects this promise while the handler's work carries on
 * unattended; for a browser-driving job that would leave a live Chromium
 * process behind. Honouring the signal is the handler's job, and this is
 * what makes that possible.
 */
export const runWithTimeout = async <T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> => {
  const controller = new AbortController()
  const cleanup = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)

  try {
    // Promise.race attaches a reaction to run()'s promise, so a rejection
    // arriving after the timeout wins the race is still handled here rather
    // than becoming an unhandled rejection - do not "simplify" this away.
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => { reject(new JobTimeoutError(timeoutMs)) },
          { signal: cleanup.signal }
        )
      })
    ])
  } finally {
    clearTimeout(timer)
    // A handler that outlives the race may keep the signal we handed it.
    // Detaching our listener stops that retention from also pinning this
    // promise's reject closure.
    cleanup.abort()
  }
}
