import react from '@vitejs/plugin-react'
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

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // `changeOrigin: false` so the Host header stays `localhost:5173`. The
      // server sets the session cookie without an explicit domain, which binds
      // it to the host it saw; rewriting that would bind it to the API's host
      // and the browser would then refuse to send it back.
      '/api': { target: API_TARGET, changeOrigin: false }
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
