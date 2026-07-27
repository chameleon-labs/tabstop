# tabstop server

Node.js + TypeScript backend, following the Clean Architecture layering scaffolded from [chameleon-labs/clean-node-template](https://github.com/chameleon-labs/clean-node-template).

## Layers

```
src/
  domain/         interfaces + models only — no dependency on anything else
  data/           usecase implementations, depending on domain + protocols (interfaces) it defines for infra
  infra/          concrete implementations of data's protocols (db, external services, system, ...)
  presentation/   controllers + http protocols, framework-agnostic
  main/           composition root — factories wire concrete classes together, config, routes, http adapter
```

Dependency direction always points inward: `main` depends on everything; `domain` depends on nothing. Swapping `infra` (e.g. a real database, the audit worker) never touches `domain`, `data`, or `presentation` — only the factory in `main` that wires it up.

## Current state

`GET /api/health` (including a Postgres reachability probe) and the account slice — signup, login, logout and `GET /api/me` — exist so far. A BullMQ queue and a separate worker process are also wired up: the worker consumes the `ping` heartbeat queue, and jobs are currently enqueued by the test suite and by hand — nothing in production enqueues one yet. A scheduled producer arrives with cron support. No real job (the audit worker) exists yet. See `../DECISIONS.md` for stack decisions and `docs/superpowers/specs/` for designs.

## Stack

Express 5 · TypeScript 7 · Kysely + Postgres · BullMQ + Redis · zod · Playwright + axe-core · Vitest + Supertest + Testcontainers · pnpm.

Deliberately excluded to keep this minimal, same reasoning as the template: no `dotenv`, no `cors` package, no `cookie-parser`, no ESLint (`typescript-eslint` doesn't support TS 7 yet), and no password-hashing or JWT library — `node:crypto` covers both.

## Conventions

- **`type: module` + `NodeNext` resolution**: relative imports need an explicit `.js` extension even though the source file is `.ts` (e.g. `import { x } from './x.js'` from `x.ts`).
- One usecase = one file per layer + one factory + one route, named identically across layers. Grep the usecase name to find every file that makes it up.

## Commands

```bash
pnpm install
docker compose up -d   # local Postgres + Redis, required by pnpm dev
pnpm migrate           # run migrations
pnpm dev          # tsx watch, loads .env
pnpm dev:worker        # worker process, tsx watch
pnpm test         # requires Docker: starts a throwaway Postgres + Redis per run
pnpm test:watch
pnpm typecheck
pnpm build         # tsc -> dist/
pnpm start          # run built output
pnpm start:worker      # run built worker
```

Copy `.env.example` to `.env` before running. That copy only happens once: if your checkout has an older `.env` predating a variable added to `.env.example` (e.g. `REDIS_URL`, and now `FRONTEND_ORIGIN` and `SESSION_COOKIE_SECURE`), re-diff the two by hand after pulling — nothing will do it for you, and the failure mode is an opaque `... is required but was not set` at startup.

## Database

Kysely over `pg`. `makeDatabase(url)` in `infra/db/postgres/helpers/` is a pure factory; the single long-lived instance lives in `main/config/database.ts`. Adapters receive `Kysely<Database>` through their constructor — they never reach for a global.

Migrations are registered in `infra/db/postgres/migrations/index.ts` rather than discovered from disk, because Kysely's `FileMigrationProvider` resolves paths relative to `__dirname`, which differs between `tsx`, `dist/`, and Vitest under `"type": "module"`.

Note the migration API is imported from the `kysely/migration` subpath; importing it from `kysely` fails typecheck by design.

## Queue

BullMQ over Redis. `makeQueue` / `makeWorker` in `infra/queue/helpers/` are pure factories; the API process and the worker each construct what they need and own its lifetime.

Two things about BullMQ's types are worth knowing before touching this code:

- `Queue` must be typed `Queue<Job<TPayload, void, string>>`. It derives its name type through a conditional that never resolves for a bare generic payload, so `Queue<TPayload>` makes `add()` reject a plain string name.
- `Worker` must be typed `Worker<TPayload, void, string>` — plain generics, the opposite form.

Connections are configured with `{ connection: { url } }`. BullMQ then sets `maxRetriesPerRequest: null` itself for blocking connections; passing a hand-built `ioredis` instance instead makes that your responsibility, which is a common source of silent breakage.

BullMQ has no per-job timeout, so handlers that can hang wrap themselves in `runWithTimeout`, which passes an `AbortSignal` into the handler.

To exercise the `ping` queue by hand against a running worker (`pnpm dev:worker` or `pnpm start:worker`):

```bash
node --env-file=.env --input-type=module -e "
import { Queue } from 'bullmq'
const q = new Queue('ping', { connection: { url: process.env.REDIS_URL } })
await q.add('ping', { requestedAt: new Date().toISOString() })
await q.close()
"
```

## Audit worker

The `audit` queue runs accessibility audits: navigate with Chromium, inject vendored axe-core, store violations. `pnpm dev:worker` consumes both `ping` and `audit`.

- **axe-core is vendored, not imported at runtime.** `src/infra/audit/vendor/axe.min.js` is checked in; refresh it with `pnpm vendor:axe`, which also rewrites the sibling `VERSION` file. The reported `axe_version` comes from `testEngine.version` in the run itself, so it can never disagree with the file that executed.
- **`pnpm build` copies that file explicitly.** `tsc` compiles `.ts` and ignores everything else, so without `scripts/copy-vendor.mjs` the engine never reaches `dist/` — and it fails only in production. A spec asserts the built file exists, and CI builds before testing.
- **Playwright is imported in exactly one file**, `infra/audit/playwright-axe-auditor.ts`. Everything above it works against the `PageAuditor` protocol, which is why the whole status machine is testable in milliseconds with no browser.
- **`bypassCSP: true` is load-bearing** — a well-configured Content-Security-Policy otherwise blocks the injected engine.
- **A page that never reaches network idle is still audited**, with `audits.settled` set to false. Treat a score with `settled = false` as provisional.
- **Chromium must be installed wherever the worker runs — production included.** Installing the npm package does not provide a browser binary, so a fresh worker host fails at `chromium.launch()` until:

  ```bash
  pnpm exec playwright install --with-deps chromium
  ```

  `--with-deps` also installs the OS libraries Chromium needs, which a slim container image will not have. This is a deploy requirement (#16), not just a test-setup step. `playwright` is a runtime **dependency** for the same reason: a `pnpm install --prod` that omitted it would fail the worker at module load, before it could consume a single job.

Budgets are env-configurable: `AUDIT_CONCURRENCY` (default 1 — Chromium is 300–500MB per context), `AUDIT_JOB_TIMEOUT_MS` (45s), `AUDIT_NAVIGATION_TIMEOUT_MS` (20s), `AUDIT_SETTLE_BUDGET_MS` (10s), `AUDIT_FALLBACK_SETTLE_MS` (1s).

## Schema

Seven tables, across five migrations in `src/infra/db/postgres/migrations/`:

| Table | Notes |
|---|---|
| `users` | `email` is stored lowercased; `alert_threshold` (score points) is read by regression detection |
| `sessions` | primary key **is** the cookie value; `expires_at` is filtered in SQL so no caller can forget it |
| `sites` | `unique (user_id, domain)`; deleting a user cascades all the way down |
| `pages` | `unique (site_id, url)`; deleting a page cascades to everything below |
| `audits` | `page_id` null = anonymous one-off; addressed publicly by `public_uuid`; `settled` false means the page never finished loading, so treat the result as provisional; `claimed_at` leases the row to one worker |
| `violations` | `nodes` is display-only jsonb, never queried across; `impact` is nullable, because axe reports violations with no severity and dropping them would hide real findings |
| `alert_events` | at most one row per page per **UTC** day, keyed on `created_at` (detection) — not `emailed_at`, which stays null until a confirmed send |

Two rules when working with this schema:

- **Write jsonb with `JSON.stringify`.** The column types require a string on insert for exactly this reason — passing a JS array through directly makes node-postgres emit a Postgres array literal, which jsonb rejects.
- **Compare jsonb structurally in tests.** jsonb reorders object keys, so `JSON.stringify` equality fails spuriously.

Specs share one database and run in parallel, so they create `randomUUID()`-suffixed fixtures and never `TRUNCATE`.

## Auth

Sessions are an opaque id — 32 random bytes as hex — in an `httpOnly`, `SameSite=Lax`, host-only cookie backed by the `sessions` table. The cookie is named **`__Host-sid`** wherever `SESSION_COOKIE_SECURE=true`, falling back to `sid` over plain http where the prefix is invalid — so production and local development differ, which matters when debugging. Logout deletes the row, so revocation is real rather than a client-side cookie clear.

Four things to know before touching it:

- **Express 5 writes cookies but cannot read them.** `res.cookie()` is core; `req.cookies` does not exist, because core ships no parser. `main/adapters/cookies.ts` parses the header instead — the session id is hex, so percent-decoding never arises.
- **Controllers never touch Express.** An `HttpResponse` may carry `cookies: CookieDirective[]` describing what to set or clear; `adaptRoute` applies it and owns `httpOnly`, `sameSite`, `secure` and `path`, so a controller cannot weaken them and there is one place to audit.
- **`adaptRoute` merges `res.locals` last**, after body, params and query. With it first, a client posts `{"userId": ...}` and impersonates. A spec pins the ordering; reversing the spread fails it.
- **State-changing requests are origin-checked.** `SameSite=Lax` blocks a cross-*site* form POST, but the app and API share a registrable domain by design, so a sibling host is same-site and its POST would carry the cookie. `sameOrigin` rejects a mismatched `Origin` on POST/PUT/PATCH/DELETE; an absent `Origin` is allowed, since browsers always send it on those methods.
- **The frontend and API must share a registrable domain** (`app.example.com` and `api.example.com`). `SameSite=Lax` otherwise makes the session a third-party cookie, which Safari blocks outright — login appears to succeed and nothing is ever authenticated. Clients must also send `credentials: 'include'` on every request, and read auth state from `GET /api/me` rather than from storage, since `httpOnly` means JavaScript can never see the cookie.

Passwords use `node:crypto` scrypt with a self-describing digest (`scrypt$N$r$p$salt$key`), so `SCRYPT_COST` can rise later without invalidating stored passwords. The suite lowers the cost — at the production setting each hash is ~89ms and would dominate the run.
