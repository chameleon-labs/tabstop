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

Five slices exist:

- **Health** — `GET /api/health`, including a Postgres reachability probe.
- **Accounts** — signup, login, logout and `GET /api/me`, on server-side sessions.
- **Audits** — `POST /api/audits` (anonymous, one-off) and the public `GET /api/audits/:uuid`. A BullMQ queue and a separate worker process run them with Playwright Chromium and vendored axe-core.
- **Pages** — `POST/GET /api/pages`, `PATCH/DELETE /api/pages/:id` and `GET /api/pages/:id/history`, all behind the auth middleware. Adding a page creates its `Site` if needed, enforces the per-account cap, and starts a first audit; `GET` answers the whole dashboard — latest audit, score, previous score and a bounded sparkline — in a fixed number of queries.

- **Daily re-audits** — a BullMQ job scheduler in the worker fans out one audit per monitored page every night, spread over a six-hour window by a per-domain offset. See *Re-audit scheduler* below.

Not built yet: regression detection, alert email, and every frontend screen. See `../DECISIONS.md` for stack decisions, `docs/superpowers/specs/` for designs and `docs/superpowers/plans/` for the plans they turned into.

## Stack

Express 5 · TypeScript 7 (ES2024) · Kysely + Postgres · BullMQ + Redis · zod · Playwright + axe-core · Vitest + Supertest + Testcontainers · pnpm.

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

`backlogCount` — the number `POST /api/audits` refuses submissions on — counts **waiting** jobs only, not delayed ones. It counted both until the re-audit scheduler landed, on the premise that a delayed audit could only be one inside its retry backoff. That scheduler broke the premise deliberately, and counting work it had parked hours into the future would have made the submission endpoint answer 503 for six hours a night against idle workers.

To exercise the `ping` queue by hand against a running worker (`pnpm dev:worker` or `pnpm start:worker`):

```bash
node --env-file=.env --input-type=module -e "
import { Queue } from 'bullmq'
const q = new Queue('ping', { connection: { url: process.env.REDIS_URL } })
await q.add('ping', { requestedAt: new Date().toISOString() })
await q.close()
"
```

## API

| Route | Notes |
|---|---|
| `GET /api/health` | includes a Postgres reachability probe |
| `POST /api/signup` · `login` · `logout` · `GET /api/me` | session cookie, see Auth |
| `POST /api/audits` | anonymous one-off audit, validated by gate 1 (parse **and** resolve). Always registered, rate limited per IP |
| `GET /api/audits/:uuid` | fully public, gated only by an unguessable uuid. Rate limited per IP |

`GET /api/audits/:uuid` returns one shape for all four states so a client narrows on `status`. Its payload is built by an explicit mapper in `presentation/helpers/audit-view.ts` — **never spread from the model**, because `AuditModel` carries `pageId` and that links to an account. A terminal audit is cacheable (`public, max-age=3600`); an in-flight one is `no-store`.

### Rate limiting

A Redis token bucket in front of `POST /api/audits`, `GET /api/audits/:uuid`, `/signup`, `/login` (per IP and, separately, per submitted email), `/logout` and `GET /api/me`. `/logout`'s bucket is deliberately the loosest of them — signing out is idempotent and someone with several tabs may fire it more than once, so the capacity sits far above any genuine client — but it is not unlimited: every call carrying a cookie is an indexed DELETE, and an anonymous caller can drive those as fast as it opens sockets. When Redis cannot answer, the limiter degrades to a per-instance in-memory bucket rather than rejecting — see `DECISIONS.md` for why.

`TRUST_PROXY_HOPS` (default `0`) is how many reverse proxies sit in front of the process; Express reads the client IP from that many positions in `X-Forwarded-For`. It must be a real hop count, never `true` — see the comment in `main/config/app.ts`.

Every bucket except the anonymous audit one is a constant in `main/config/rate-limits.ts`. The audit bucket is env-configurable because it is the cost dial: `AUDIT_RATE_CAPACITY` (default `5`) and `AUDIT_RATE_PER_HOUR` (default `5`).

## Audit worker

The `audit` queue runs accessibility audits: navigate with Chromium, inject vendored axe-core, store violations, and score the page. `pnpm dev:worker` consumes `ping`, `audit` and `reaudit`.

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

## Re-audit scheduler

The nightly fan-out that makes this a monitoring product rather than a one-off audit tool. It runs in the **worker**, on the `reaudit` queue, at `0 2 * * *` **UTC** — a BullMQ job scheduler, so it fires once however many worker replicas are running. The handler enqueues onto the same `audit` queue everything else uses, so re-audits and one-off submissions share one concurrency cap and one worker pool.

- **Jitter is deterministic per domain**, not random: FNV-1a over the host, modulo a six-hour window, plus a minute per page for pages sharing a domain. A page is therefore audited at roughly the same time every night, so its own trend line stays comparable — and one origin never receives every page at once. `domain/services/reaudit-schedule.ts`, pure and dependency-free.
- **Exactly one audit per page per UTC day, in two layers.** The eligibility query skips pages with an audit in flight or one created since midnight UTC. Underneath it, `audits_one_scheduled_per_page_per_day` — a partial unique index on `(page_id, scheduled_for)` — makes it true regardless: two overlapping runs both select the page, and the second insert returns no row.
- **`scheduled_for` is the run's day, stamped by the scheduler and nothing else.** Deriving it from `created_at` would have constrained *manual* re-audits to one per page per day too, and would split a fan-out that crosses midnight across two days. The column is write-only: node-postgres parses a `date` at local midnight, so nothing reads it back.
- **A failed enqueue deletes its audit row.** A queued audit nothing will run shows as permanently in progress, and it would keep the page out of every future night's worklist. An *unconfirmed* enqueue keeps the row — the queue may have taken the job and lost the reply.
- **Every run logs one structured line**, `{"event":"reaudit-run", ...}`, including the nights it finds nothing to do. A summary that only appears when there is work is one nobody notices the absence of, and a scheduler that stops firing breaks this product silently. #25 forwards it to PostHog.
- **The session sweeper is not on this scheduler**, deliberately. It stays a plain timer, because #10's design turns on authentication not depending on Redis.

### URL safety

Auditing a user-supplied URL is an SSRF primitive, so the worker refuses private and reserved addresses, non-http schemes, and any port other than 80 or 443.

- **`domain/services/url-safety.ts` is pure** — no DNS, no network, no clock. That is what makes the range list cheap to test exhaustively, and exhaustive tests are the only thing that catches this class of bug.
- **Redirects are followed by the guard, not the browser.** `context.route` fires only for the first hop, so a `302` to a private address would otherwise never be checked. `infra/audit/request-guard.ts` walks the chain with `route.fetch({ maxRedirects: 0 })`, validating each hop and capping at five.
- **Every request is checked**, not just navigations — a page can embed a subresource pointing at an internal host. A blocked subresource refuses only itself, so the page still audits.
- **The submitted URL is validated before navigating**, not only by the route guard: `file:` and `data:` need not produce an interceptable request at all.
- **WebRTC and WebTransport are removed** before page scripts run. Neither interceptor sees them, and a data channel needs no permission. Init scripts do not reach dedicated workers, so that residual is recorded on #16 with downloads.
- **Redirects keep the browser's document URL.** The guard validates the chain, then hands the browser a redirect to the final address rather than serving the final body against the original URL — which would leave relative assets resolving against the wrong base.
- **Downloads are a known gap.** `context.route` does not see them, and a download request reaches the network even with `acceptDownloads: false` — verified. Nothing is written to disk, but the request leaves. Closing it needs egress policy at the infrastructure level (#16).
- **WebSockets are refused, not validated.** `context.route` does not see them, so a page could otherwise open a socket straight past every check. Nothing an audit needs arrives over one.
- **Redirects follow browser method semantics** — 303, 301 and 302 demote to GET and drop the body; 307 and 308 preserve it. Replaying a POST at every hop would repeat side effects the server has already performed.
- **Rejection messages never distinguish blocked from unreachable.** Everything becomes `That address can't be audited`. Anything more specific turns the audit endpoint into an internal port scanner.
- The submission-time gate arrives with #9, in its `request-audit` usecase.

Budgets are env-configurable: `AUDIT_CONCURRENCY` (default 1 — Chromium is 300–500MB per context), `AUDIT_JOB_TIMEOUT_MS` (45s), `AUDIT_NAVIGATION_TIMEOUT_MS` (20s), `AUDIT_SETTLE_BUDGET_MS` (10s), `AUDIT_FALLBACK_SETTLE_MS` (1s).

`AUDIT_CONCURRENCY` is applied **globally**, not per process: each worker passes it as its own `concurrency` and also writes it to the queue as BullMQ's global concurrency at startup, so N replicas run N × the limit only if the second mechanism fails. Because it is set at startup, the effective value is the one the most recently started worker was configured with.

## Schema

Seven tables, across seven migrations in `src/infra/db/postgres/migrations/`:

| Table | Notes |
|---|---|
| `users` | `email` is stored lowercased; `alert_threshold` (score points) is read by regression detection |
| `sessions` | primary key **is** the cookie value; `expires_at` is filtered in SQL so no caller can forget it |
| `sites` | `unique (user_id, domain)`; deleting a user cascades all the way down |
| `pages` | `unique (site_id, url)`; deleting a page cascades to everything below |
| `audits` | `page_id` null = anonymous one-off; addressed publicly by `public_uuid`; `score` and `counts_by_impact` are written by the domain score formula when the audit completes; `settled` false means the page never finished loading, so treat the result as provisional; `claimed_at` leases the row to one worker; `scheduled_for` is set only by the nightly run and is what dedupes it — null for every other audit, and never read back |
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
