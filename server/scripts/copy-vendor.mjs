import { cpSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// tsc compiles .ts and ignores everything else, so the vendored engine would
// never reach dist/. That failure appears only in production, which is why a
// spec asserts the built file exists.
const from = fileURLToPath(new URL('../src/infra/audit/vendor/', import.meta.url))
const to = fileURLToPath(new URL('../dist/infra/audit/vendor/', import.meta.url))

cpSync(from, to, { recursive: true })
console.log('Copied src/infra/audit/vendor/ -> dist/infra/audit/vendor/')
