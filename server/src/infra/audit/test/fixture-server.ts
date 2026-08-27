import {createServer, type Server} from 'node:http';
import {WebSocketServer} from 'ws';
import type {AddressInfo} from 'node:net';

const VIOLATING_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fixture</title></head>
<body><main>
  <h1>Fixture page</h1>
  <input type="text">
  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
  <p style="color:#bbb;background:#fff">low contrast text</p>
</main></body></html>`;

const NEVER_IDLE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Never idle</title></head>
<body><main>
  <h1>Never idle</h1>
  <input type="text">
  <script>setInterval(function () { fetch('/slow').catch(function () {}) }, 200)</script>
</main></body></html>`;

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
</main></body></html>`;

const PRIVATE_SUBRESOURCE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Embedded</title></head>
<body><main>
  <h1>Page with a hostile embed</h1>
  <input type="text">
  <img src="http://10.0.0.5/tracker.png" alt="">
</main></body></html>`;

const SERVICE_WORKER_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Worker</title></head>
<body><main><h1>Registers a worker</h1><input type="text">
<script>
  navigator.serviceWorker.register('/sw.js')
    .then(function () { window.__swRegistered = true })
    .catch(function () { window.__swRegistered = false })
</script>
</main></body></html>`;

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
</main></body></html>`;

const REDIRECT_TARGET_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Target</title></head>
<body><main>
  <h1>Redirect target</h1>
  <script src="inject.js"></script>
</main></body></html>`;

const INJECTED_SCRIPT = `
  var img = document.createElement('img')
  img.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==')
  document.querySelector('main').appendChild(img)
`;

export type FixtureServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

export const startFixtureServer = async (): Promise<FixtureServer> => {
  const server: Server = createServer((request, response) => {
    if (request.url === '/slow') {
      return;
    }

    if (request.url === '/never-idle') {
      response.writeHead(200, {'content-type': 'text/html'});
      response.end(NEVER_IDLE_PAGE);
      return;
    }

    if (request.url === '/shadow') {
      response.writeHead(200, {'content-type': 'text/html'});
      response.end(SHADOW_PAGE);
      return;
    }

    if (request.url === '/redirect-to-private') {
      response.writeHead(302, {location: 'http://169.254.169.254/latest/meta-data/'});
      response.end();
      return;
    }

    if (request.url === '/redirect-to-file') {
      response.writeHead(302, {location: 'file:///etc/passwd'});
      response.end();
      return;
    }

    if (request.url === '/redirect-loop') {
      response.writeHead(302, {location: '/redirect-loop'});
      response.end();
      return;
    }

    if (request.url === '/private-subresource') {
      response.writeHead(200, {'content-type': 'text/html'});
      response.end(PRIVATE_SUBRESOURCE_PAGE);
      return;
    }

    if (request.url === '/redirect-to-dir') {
      response.writeHead(302, {location: '/dir/page'});
      response.end();
      return;
    }

    if (request.url === '/dir/page') {
      response.writeHead(200, {'content-type': 'text/html'});
      response.end(REDIRECT_TARGET_PAGE);
      return;
    }

    if (request.url === '/dir/inject.js') {
      response.writeHead(200, {'content-type': 'text/javascript'});
      response.end(INJECTED_SCRIPT);
      return;
    }

    if (request.url === '/websocket-page') {
      response.writeHead(200, {'content-type': 'text/html'});
      response.end(WEBSOCKET_PAGE);
      return;
    }

    if (request.url === '/service-worker-page') {
      response.writeHead(200, {'content-type': 'text/html'});
      response.end(SERVICE_WORKER_PAGE);
      return;
    }

    if (request.url === '/sw.js') {
      response.writeHead(200, {'content-type': 'text/javascript'});
      response.end('self.addEventListener("fetch", function () {})');
      return;
    }

    if (request.url === '/csp') {
      response.writeHead(200, {
        'content-type': 'text/html',
        'content-security-policy': "default-src 'self'; script-src 'self'",
      });
      response.end(VIOLATING_PAGE);
      return;
    }

    response.writeHead(200, {'content-type': 'text/html'});
    response.end(VIOLATING_PAGE);
  });

  const sockets = new WebSocketServer({server, path: '/socket'});
  sockets.on('connection', (socket) => {
    socket.send('connected');
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve) => {
        sockets.close(() => {
          resolve();
        });
      });
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      });
    },
  };
};
