import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createLogger, type Plugin } from 'vite'
import { injectAppShell } from './src/prerender/inject.ts'
import { servesAppShell } from './src/prerender/paths.ts'
// `vitest/config` rather than `vite`: as of Vitest 4 the `test` key is not
// merged into Vite's own config type, so importing from `vite` typechecks the
// build config and silently rejects the test config beside it.
import { defineConfig } from 'vitest/config'

/**
 * The API origin the app talks to.
 *
 * Empty in development ON PURPOSE, so every request is same-origin and falls
 * through the proxy below - which is also what keeps the session cookie working
 * locally without any CORS or SameSite exemption. Production sets
 * `VITE_API_URL` to the real API origin; see `src/api/client.ts`, which reads it.
 */
const API_TARGET = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3000'

/**
 * One line per outage instead of one stack trace per request.
 *
 * `pnpm dev` at the repository root runs this and the server into a single
 * stream, and a server that failed to boot is the common case for it - a
 * missing env var, a database that is not up. Vite then logs an ECONNREFUSED
 * stack for every poll and every reload: measured at 48 in fifteen seconds,
 * which buried the server's own error - the one line saying what to fix - under
 * two hundred lines of noise. In two terminals this problem does not exist;
 * merging the streams is what creates it, so the repair belongs with it.
 *
 * TWO PIECES, because neither works alone. This handler cannot suppress Vite's
 * logging - its own `error` listener stays attached and is also what ends the
 * request, so removing it would hang every call instead of failing it - and
 * `quietProxyErrors` below cannot say anything useful, because by the time a
 * log line exists the cause is already a stack trace.
 *
 * Latched rather than throttled, and cleared by the first response that gets
 * through, so a SECOND outage is reported as loudly as the first. A timer would
 * have to guess an interval; a response arriving is the actual signal that the
 * condition ended.
 */
const reportProxyOutage = (proxy: {
  on: (event: string, listener: (...args: unknown[]) => void) => void
}): void => {
  let reported = false

  proxy.on('error', () => {
    if (reported) { return }
    reported = true
    console.error(
      `\n  [api] cannot reach ${API_TARGET} - is the server running, and did it boot?` +
      '\n        Check the `server` lines above for why.\n'
    )
  })

  proxy.on('proxyRes', () => { reported = false })
}

/**
 * Drops Vite's own proxy-error stacks, which `reportProxyOutage` has already
 * replaced with something that names the likely cause.
 *
 * Only that one message, and only its text - every other line Vite logs passes
 * through untouched. The cost of being wrong is bounded and visible: if a
 * genuinely different proxy failure ever hides here, the line above still
 * prints once, so the signal that something is wrong survives even when this
 * swallows the detail.
 */
const quietProxyErrors = (): ReturnType<typeof createLogger> => {
  const logger = createLogger()
  const error = logger.error.bind(logger)

  logger.error = (message, options): void => {
    if (message.includes('http proxy error')) { return }
    error(message, options)
  }

  return logger
}


/**
 * The dev and preview servers serve what the host serves, or they are lying.
 *
 * `pnpm dev` hands every route an empty `<div id="root">` and then streams
 * hundreds of unbundled modules into it. Measured on Slow 3G: no paint at all
 * after forty seconds. Production has shipped a boot skeleton in `app.html`
 * since this change, so without this the environment the work is done in is
 * the only one that still goes blank.
 *
 * `vite preview` has the matching problem: it ignores `_redirects` and answers
 * `/dashboard` with `index.html`, the LANDING page's prerendered markup. A
 * local check of the built app therefore measures a file the host never serves
 * for that path.
 */
const bootSkeleton = (): Plugin => {
  const require = createRequire(import.meta.url)
  const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
  const css = {
    skeleton: read('./src/screens/components/RouteSkeleton/route-skeleton.css'),
    app: read('./src/styles.css'),
    lattice: readFileSync(require.resolve('@chameleon-labs/lattice-tokens/lattice.css'), 'utf8'),
  }
  return {
    name: 'tabstop:boot-skeleton',
    // Never at build time: `scripts/prerender.ts` owns `app.html` there, and a
    // second injection would leave `injectMarkup` with no `<div id="root">` to
    // replace.
    apply: 'serve',
    transformIndexHtml: {
      order: 'post',
      handler: (html, ctx) =>
        servesAppShell(ctx.originalUrl ?? '/') ? injectAppShell(html, css.skeleton, css.app, css.lattice) : html,
    },
    configurePreviewServer: (server) => {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url ?? '/').split('?')[0]!
        if (servesAppShell(path) && !/\.[a-z0-9]+$/i.test(path)) {
          req.url = '/app.html'
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), bootSkeleton()],
  // `@/` is the src root. Feature folders nest four deep, and the relative
  // alternative - `../../../../api/client` - is both unreadable and silently
  // wrong after any move. `tsconfig.json` declares the same mapping so the
  // compiler and the bundler cannot disagree.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  customLogger: quietProxyErrors(),
  // Read by `scripts/prerender.ts`. A lazy route's stylesheets are attached to
  // its chunk, and the manifest is the only record of which ones - without it
  // a prerendered page paints unstyled until its JavaScript arrives.
  build: { manifest: true },
  server: {
    proxy: {
      // The proxy is what makes the session cookie work in development, and the
      // mechanism is the REQUEST URL rather than any header. `Set-Cookie` here
      // carries no `Domain`, so the browser scopes the cookie to the host it
      // asked - `localhost:5173` - and sends it back on every same-origin call.
      // Point the app straight at `localhost:3000` instead and the cookie is
      // scoped to a different origin, which is where cross-site rules start
      // deciding whether it travels.
      //
      // `changeOrigin` is deliberately not set. It rewrites the Host header
      // sent UPSTREAM, which has no bearing on cookie scope - the browser never
      // sees it - and nothing on the server reads Host either: `same-origin.ts`
      // checks `Origin`, and `PUBLIC_API_ORIGIN` is configuration.
      '/api': { target: API_TARGET, configure: reportProxyOutage }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{spec,test}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/**/*.{spec,test}.{ts,tsx}', 'src/test/**']
    }
  }
})
