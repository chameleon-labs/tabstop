import express from 'express'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { startListening } from './listen.js'

/**
 * Two servers, one port, in one process.
 *
 * The bug was found with another application holding 3000 and again with a
 * `tsx watch` reload racing itself, but a spec must not depend on either. Two
 * listeners in one test reproduce the same `EADDRINUSE` with nothing external.
 */
const reports = (): { lines: string[], fatal: string[], handlers: Parameters<typeof startListening>[2] } => {
  const lines: string[] = []
  const fatal: string[] = []
  return { lines, fatal, handlers: { info: (m) => lines.push(m), fatal: (m) => fatal.push(m) } }
}

const settled = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 150))
}

describe('startListening', () => {
  const open: Server[] = []

  afterEach(async () => {
    for (const server of open.splice(0)) {
      await new Promise((resolve) => { server.close(() => { resolve(null) }) })
    }
  })

  const listen = (port: number, handlers: Parameters<typeof startListening>[2]): Server => {
    const server = startListening(express(), port, handlers)
    open.push(server)
    return server
  }

  it('says it is running once it is', async () => {
    const { lines, handlers } = reports()

    listen(0, handlers)
    await settled()

    expect(lines.join('\n')).toMatch(/Server running/)
  })

  it('names the address it actually bound, not the one it was asked for', async () => {
    // Port 0 is the clearest case: what the caller asked for is never what it
    // got, so a line built from the requested port is provably wrong.
    const { lines, handlers } = reports()

    const server = listen(0, handlers)
    await settled()
    const address = server.address()
    const port = address !== null && typeof address !== 'string' ? address.port : 0

    expect(port).toBeGreaterThan(0)
    expect(lines.join('\n')).toContain(String(port))
  })

  it('does not claim to be running when the bind failed', async () => {
    // The defect. Express 5 runs the listen callback even when the bind failed
    // - `listening` is false and `address()` is null - so the one line a reader
    // uses to know the server is up was printed on the path where it is down.
    const first = reports()
    const server = listen(0, first.handlers)
    await settled()
    const address = server.address()
    const port = address !== null && typeof address !== 'string' ? address.port : 0

    const second = reports()
    listen(port, second.handlers)
    await settled()

    expect(second.lines.join('\n')).not.toMatch(/Server running/)
  })

  it('reports the conflict, and names the port so it can be freed', async () => {
    const first = reports()
    const server = listen(0, first.handlers)
    await settled()
    const address = server.address()
    const port = address !== null && typeof address !== 'string' ? address.port : 0

    const second = reports()
    listen(port, second.handlers)
    await settled()

    expect(second.fatal.join('\n')).toMatch(/EADDRINUSE|already in use/i)
    expect(second.fatal.join('\n')).toContain(String(port))
  })

  it('treats a failed bind as fatal, so a supervisor learns what the log says', async () => {
    // Nothing exits today, which is why the failure is invisible: the process
    // stays alive holding no socket and `--kill-others` sees no exit.
    const first = reports()
    const server = listen(0, first.handlers)
    await settled()
    const address = server.address()
    const port = address !== null && typeof address !== 'string' ? address.port : 0

    const second = reports()
    listen(port, second.handlers)
    await settled()

    expect(second.fatal).toHaveLength(1)
  })
})
