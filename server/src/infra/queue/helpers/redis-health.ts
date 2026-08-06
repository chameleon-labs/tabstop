import { Redis } from 'ioredis'

export type RedisWatcher = {
  close: () => Promise<void>
}

export type ReportLine = (message: string) => void

/**
 * The address, without whatever credentials the URL carries.
 *
 * "Redis unreachable" on its own sends the reader to the wrong config file when
 * two are in play, and the raw URL cannot be printed because it may hold a
 * password.
 */
const addressOf = (url: string): string => {
  try {
    const parsed = new URL(url)
    return parsed.port === '' ? parsed.hostname : `${parsed.hostname}:${parsed.port}`
  } catch {
    return 'the configured address'
  }
}

/**
 * Says whether the worker can reach Redis.
 *
 * The worker had no answer to this. `ioredis` retries indefinitely - which is
 * correct, and what BullMQ relies on - so a Redis that is down produces no
 * error, no warning and no `Worker started` line. The process sits there
 * looking like a healthy one that has not printed yet, while nothing consumes
 * the queue and every audit stays `queued`.
 *
 * Its own connection rather than one borrowed from a queue, because the
 * question has to be answerable BEFORE the first queue call: startup awaits
 * `setGlobalConcurrency`, and that await is where an unreachable Redis hangs,
 * before any worker exists to carry an error handler.
 *
 * Transitions only. A worker that cannot reach Redis for an hour must not
 * produce an hour of identical lines, so what is reported is up-to-down and
 * down-to-up, never the attempts in between.
 */
export const watchRedis = (url: string, report: ReportLine): RedisWatcher => {
  const address = addressOf(url)
  const client = new Redis(url, {
    // BullMQ's own setting, kept so this connection retries the same way the
    // ones it is reporting on do.
    maxRetriesPerRequest: null,
    // Nothing here issues commands, so a queued command must never hold the
    // process open waiting for a connection that is not coming.
    enableOfflineQueue: false
  })

  let reachable: boolean | null = null

  const transition = (next: boolean, message: string): void => {
    if (reachable === next) return
    reachable = next
    report(message)
  }

  client.on('ready', () => { transition(true, `Redis connected at ${address}`) })
  client.on('error', (error: Error) => {
    transition(false, `Redis unreachable at ${address} - retrying (${error.message})`)
  })

  return {
    close: async () => {
      client.removeAllListeners()
      // `disconnect` rather than `quit`: quit writes a command, and a client
      // that never connected has nowhere to write it.
      client.disconnect()
    }
  }
}
