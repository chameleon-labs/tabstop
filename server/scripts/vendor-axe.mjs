import { copyFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Vendored rather than imported at runtime, per DECISIONS.md ("vendor
// axe-core, don't wrap it"): one fewer dependency between us and the engine,
// and the reported axe_version is a property of a file we can see.
const require = createRequire(import.meta.url)
const source = require.resolve('axe-core/axe.min.js')
const version = require('axe-core/package.json').version

const target = fileURLToPath(new URL('../src/infra/audit/vendor/', import.meta.url))
mkdirSync(target, { recursive: true })
copyFileSync(source, `${target}axe.min.js`)
writeFileSync(`${target}VERSION`, `${version}\n`)

console.log(`Vendored axe-core ${version} into src/infra/audit/vendor/`)
