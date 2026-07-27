import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A page with three known, stable violations: an input with no label, an image
 * with no alt text, and low-contrast text. Wrapped in main/h1 so the structural
 * rules (region, landmark-one-main, page-has-heading-one) stay quiet and the
 * assertions describe what the fixture is actually testing.
 */
const VIOLATING_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fixture</title></head>
<body><main>
  <h1>Fixture page</h1>
  <input type="text">
  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
  <p style="color:#bbb;background:#fff">low contrast text</p>
</main></body></html>`

/** Polls an endpoint that never responds, so network idle never arrives. */
const NEVER_IDLE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Never idle</title></head>
<body><main>
  <h1>Never idle</h1>
  <input type="text">
  <script>setInterval(function () { fetch('/slow').catch(function () {}) }, 200)</script>
</main></body></html>`

export type FixtureServer = {
  baseUrl: string
  close: () => Promise<void>
}

export const startFixtureServer = async (): Promise<FixtureServer> => {
  const server: Server = createServer((request, response) => {
    // Deliberately never responds, which is what keeps the network busy.
    if (request.url === '/slow') return

    if (request.url === '/never-idle') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(NEVER_IDLE_PAGE)
      return
    }

    if (request.url === '/csp') {
      response.writeHead(200, {
        'content-type': 'text/html',
        // Blocks injected scripts unless the context sets bypassCSP.
        'content-security-policy': "default-src 'self'; script-src 'self'"
      })
      response.end(VIOLATING_PAGE)
      return
    }

    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(VIOLATING_PAGE)
  })

  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      // Requests to /slow are still open, so destroy rather than wait them out.
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { error === undefined ? resolve() : reject(error) })
      })
    }
  }
}
