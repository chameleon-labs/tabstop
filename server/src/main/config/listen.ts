import type { Express } from 'express'
import type { Server } from 'node:http'

export type ListenHandlers = {
  /** Said once, and only about a socket that exists. */
  info: (message: string) => void
  /** The server cannot serve. Expected to end the process. */
  fatal: (message: string) => void
}

/**
 * The address a server is actually on, or null if it never bound.
 *
 * `address()` returns a string for a pipe and an object for TCP, and only the
 * object carries a port - which is the case this codebase has.
 */
const boundPort = (server: Server): number | null => {
  const address = server.address()
  if (address === null || typeof address === 'string') return null
  return address.port
}

/**
 * Listens, and says so only if it did.
 *
 * `app.listen(port, cb)` on its own is not enough to know a server is up.
 * **Express 5 runs that callback even when the bind failed** - `listening` is
 * false and `address()` is null - so the one line a reader uses to know the
 * server started was printed on the path where it did not:
 *
 * | | callback fires? | `listening` | `address()` |
 * |---|---|---|---|
 * | `http.createServer().listen()` | no, emits `EADDRINUSE` | false | null |
 * | `express@5.2.1` `app.listen(port, cb)` | YES | false | null |
 *
 * It has cost twice: another application holding the port, where every request
 * returned that application's 405 and the frontend was blamed for an hour; and
 * a `tsx watch` reload where the replacement failed to bind while the outgoing
 * process still held the socket, then sat there deaf with the log claiming
 * otherwise. The second needs nothing but ordinary editing.
 *
 * So the success line is gated on a bound socket, and it names the port that
 * was ACTUALLY bound rather than the one requested - the two differ whenever
 * port 0 is used, and can differ in ways worth seeing when they should not.
 *
 * A failed bind is fatal rather than logged. Nothing exited before, which is
 * why the failure was invisible: the process stayed alive holding no socket,
 * and a supervisor - or `concurrently --kill-others` - saw no exit to react to.
 */
export const startListening = (
  app: Express, port: number, handlers: ListenHandlers
): Server => {
  const server = app.listen(port, () => {
    const bound = boundPort(server)
    // Not `else`: the failure is reported by the error handler below, which
    // carries the reason. Saying anything here would either duplicate it or
    // guess at it.
    if (bound !== null) handlers.info(`Server running at http://localhost:${bound}`)
  })

  server.on('error', (error: NodeJS.ErrnoException) => {
    handlers.fatal(
      error.code === 'EADDRINUSE'
        ? `Port ${port} is already in use (EADDRINUSE) - stop whatever holds it, or set PORT`
        : `Server failed to listen on port ${port}: ${error.message}`
    )
  })

  return server
}
