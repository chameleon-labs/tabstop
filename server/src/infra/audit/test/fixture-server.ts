import { createServer, type Server } from 'node:http'
import { WebSocketServer } from 'ws'
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

/**
 * A violation inside a shadow root. axe reports its target as a NESTED array -
 * verified as [["#host","input"]] - which is the case the flat `string[]`
 * annotation would otherwise be lying about.
 */
const SHADOW_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Shadow</title></head>
<body><main>
  <h1>Shadow fixture</h1>
  <div id="host"></div>
  <script>
    document.getElementById('host')
      .attachShadow({ mode: 'open' })
      .innerHTML = '<input type="text">'
  </script>
</main></body></html>`

/** A valid page that pulls one subresource from a private address. */
const PRIVATE_SUBRESOURCE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Embedded</title></head>
<body><main>
  <h1>Page with a hostile embed</h1>
  <input type="text">
  <img src="http://10.0.0.5/tracker.png" alt="">
</main></body></html>`

/** Registers a service worker, whose requests context.route cannot intercept. */
const SERVICE_WORKER_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Worker</title></head>
<body><main><h1>Registers a worker</h1><input type="text">
<script>
  navigator.serviceWorker.register('/sw.js')
    .then(function () { window.__swRegistered = true })
    .catch(function () { window.__swRegistered = false })
</script>
</main></body></html>`

/**
 * Opens a socket back to the fixture server and records what happened, so a
 * spec can tell "refused" from "connected" rather than inferring it.
 */
const WEBSOCKET_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Socket</title></head>
<body><main><h1>Opens a socket</h1><input type="text">
<script>
  window.__socketOutcome = 'pending'
  var socket = new WebSocket(location.origin.replace('http', 'ws') + '/socket')
  socket.onopen = function () { window.__socketOutcome = 'open' }
  socket.onclose = function () {
    if (window.__socketOutcome !== 'open') { window.__socketOutcome = 'closed' }
  }
  socket.onerror = function () {
    if (window.__socketOutcome === 'pending') { window.__socketOutcome = 'error' }
  }
</script>
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

    if (request.url === '/shadow') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(SHADOW_PAGE)
      return
    }

    // A public page whose 302 lands on link-local - the metadata endpoint
    // every cloud provider exposes, and the reason this guard exists.
    if (request.url === '/redirect-to-private') {
      response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
      response.end()
      return
    }

    if (request.url === '/redirect-to-file') {
      response.writeHead(302, { location: 'file:///etc/passwd' })
      response.end()
      return
    }

    if (request.url === '/redirect-loop') {
      response.writeHead(302, { location: '/redirect-loop' })
      response.end()
      return
    }

    if (request.url === '/private-subresource') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(PRIVATE_SUBRESOURCE_PAGE)
      return
    }

    if (request.url === '/websocket-page') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(WEBSOCKET_PAGE)
      return
    }

    if (request.url === '/service-worker-page') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(SERVICE_WORKER_PAGE)
      return
    }

    if (request.url === '/sw.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' })
      response.end('self.addEventListener("fetch", function () {})')
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

  // A real socket server, so "the page could not connect" means the guard
  // refused it rather than there being nothing to connect to.
  const sockets = new WebSocketServer({ server, path: '/socket' })
  sockets.on('connection', (socket) => { socket.send('connected') })

  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve) => { sockets.close(() => { resolve() }) })
      // Requests to /slow are still open, so destroy rather than wait them out.
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { error === undefined ? resolve() : reject(error) })
      })
    }
  }
}
