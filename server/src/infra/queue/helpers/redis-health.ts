import { Redis } from 'ioredis'

export type RedisWatcher = {
  close: () => Promise<void>
}

export type ReportLine = (message: string) => void

/** Said when the URL names no host, so no line ever ends in a blank. */
const UNNAMED = 'the configured address'

/**
 * The address, without whatever credentials the URL carries.
 *
 * "Redis unreachable" on its own sends the reader to the wrong config file when
 * two are in play, and the raw URL cannot be printed because it may hold a
 * password.
 *
 * `host` rather than hostname and port assembled by hand: it already carries
 * the port, keeps the brackets IPv6 needs, and excludes the credentials. It is
 * EMPTY for socket-style URLs like `unix:///run/redis.sock`, which name a path
 * and no host - that used to print "unreachable at  - retrying".
 */
const addressOf = (url: string): string => {
  try {
    const { host } = new URL(url)
    return host === '' ? UNNAMED : host
  } catch {
    return UNNAMED
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
    // This helper issues no commands of its own - ioredis still runs its own
    // AUTH/SELECT/ready check - so nothing may sit buffered holding the process
    // open, waiting for a connection that is not coming.
    enableOfflineQueue: false
  })

  let reachable: boolean | null = null

  const transition = (next: boolean, message: string): void => {
    if (reachable === next) return
    reachable = next
    report(message)
  }

  const down = (reason: string): void => {
    transition(false, `Redis unreachable at ${address} - retrying (${reason})`)
  }

  client.on('ready', () => { transition(true, `Redis connected at ${address}`) })
  client.on('error', (error: Error) => { down(error.message) })
  /*
   * A DROPPED connection does not have to be an error. Redis closing cleanly -
   * a restart, a deploy, `CLIENT KILL` - sends a FIN, and ioredis reports that
   * as `connect > close > end` with no `error` at all. Listening only for
   * `error` left the watcher believing it was still connected through the whole
   * outage, and because the state never flipped it stayed silent when Redis
   * came back too: one missed event cost both lines.
   *
   * `close` also fires on every failed retry, which is why the transition guard
   * above is what keeps an hour of outage to one line.
   */
  client.on('close', () => { down('connection closed') })

  return {
    close: async () => {
      client.removeAllListeners()
      // `disconnect` rather than `quit`: quit writes a command, and a client
      // that never connected has nowhere to write it.
      client.disconnect()
    }
  }
}
