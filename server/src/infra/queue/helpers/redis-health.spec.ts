import net from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchRedis } from './redis-health.js'

const connectionString = (): string => {
  const url = process.env.REDIS_URL
  if (url === undefined) throw new Error('REDIS_URL not set by globalSetup')
  return url
}

/** Somewhere nothing listens, so the client retries rather than resolving. */
const UNREACHABLE = 'redis://127.0.0.1:1'

const reported = (): { lines: string[], log: (message: string) => void } => {
  const lines: string[] = []
  return { lines, log: (message) => lines.push(message) }
}

describe('watchRedis', () => {
  const open: Array<{ close: () => Promise<void> }> = []

  afterEach(async () => {
    for (const watcher of open.splice(0)) await watcher.close()
    vi.useRealTimers()
  })

  const watch = (url: string, log: (message: string) => void): { close: () => Promise<void> } => {
    const watcher = watchRedis(url, log)
    open.push(watcher)
    return watcher
  }

  it('says so when it reaches Redis', async () => {
    const { lines, log } = reported()

    watch(connectionString(), log)

    await vi.waitFor(() => { expect(lines.join('\n')).toMatch(/Redis connected/) })
  })

  it('says so when it cannot reach Redis, rather than waiting in silence', async () => {
    // The failure this exists for. ioredis retries indefinitely, so without a
    // listener there is no error and no line - the process looks like a healthy
    // one that has not printed yet, while nothing consumes the queue.
    const { lines, log } = reported()

    watch(UNREACHABLE, log)

    await vi.waitFor(() => { expect(lines.join('\n')).toMatch(/Redis unreachable/) })
  })

  it('reports the state once, however many times it retries', async () => {
    // A worker that cannot reach Redis for an hour must not produce an hour of
    // identical lines. What is worth saying is the transition, not the attempt.
    const { lines, log } = reported()

    watch(UNREACHABLE, log)
    await vi.waitFor(() => { expect(lines.length).toBeGreaterThan(0) })
    const afterFirst = lines.length
    // Long enough for several reconnection attempts to have gone by.
    await new Promise((resolve) => setTimeout(resolve, 600))

    expect(lines.length).toBe(afterFirst)
  })

  it('names the address it could not reach', async () => {
    // "Redis unreachable" with no address sends the reader to the wrong
    // config file when two are in play.
    const { lines, log } = reported()

    watch(UNREACHABLE, log)

    await vi.waitFor(() => { expect(lines.join('\n')).toContain('127.0.0.1:1') })
  })

  it('reports a connection dropped cleanly, which raises no error at all', async () => {
    // The case `error` alone misses. Redis closing cleanly - a restart, a
    // deploy, `CLIENT KILL` - sends a FIN, and ioredis reports that as
    // `connect > close > end` with no error. Listening only for `error` left
    // the watcher believing it was still connected for the whole outage, and
    // because the state never flipped it stayed silent on recovery too.
    //
    // A proxy that accepts and immediately ends the socket, rather than a real
    // Redis that would have to be stopped: it is the same FIN, and it cannot
    // disturb anything else sharing the test instance.
    const { lines, log } = reported()
    const live = new Set<net.Socket>()
    const server = net.createServer((socket) => {
      live.add(socket)
      socket.on('close', () => live.delete(socket))
      socket.end()
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const { port } = server.address() as net.AddressInfo

    const watcher = watch(`redis://127.0.0.1:${port}`, log)
    try {
      await vi.waitFor(() => { expect(lines.join('\n')).toMatch(/Redis unreachable/) })
    } finally {
      // The watcher first: it is retrying in a loop, so there is always a fresh
      // connection open and `server.close` - which waits for them - would never
      // return while it still runs.
      await watcher.close()
      for (const socket of live) socket.destroy()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })

  it('names an IPv6 address in a form that can be pasted back', async () => {
    // Assembled by hand from hostname and port, this keeps its brackets only by
    // accident of where they live; `::1:1` is not an address anyone can act on.
    const { lines, log } = reported()

    watch('redis://[::1]:1', log)

    await vi.waitFor(() => { expect(lines.join('\n')).toContain('[::1]:1') })
  })

  it('says something rather than nothing when the URL names no host', async () => {
    // Socket-style URLs parse, but carry a path and an empty host - which used
    // to print "Redis unreachable at  - retrying".
    const { lines, log } = reported()

    watch('unix:///nonexistent/redis.sock', log)

    await vi.waitFor(() => {
      expect(lines.join('\n')).toMatch(/Redis unreachable at the configured address/)
    })
  })

  it('reports recovery, so a queue that starts draining is explicable', async () => {
    const { lines, log } = reported()
    // Starts unreachable, then the real address: the same transition a worker
    // sees when Redis comes back, without needing to stop a container.
    const watcher = watch(UNREACHABLE, log)
    await vi.waitFor(() => { expect(lines.join('\n')).toMatch(/Redis unreachable/) })
    await watcher.close()

    watch(connectionString(), log)

    await vi.waitFor(() => { expect(lines.join('\n')).toMatch(/Redis connected/) })
  })
})
