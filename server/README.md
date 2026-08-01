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

Seven slices exist:

- **Health** — `GET /api/health`, including a Postgres reachability probe.
- **Accounts** — signup, login, logout and `GET /api/me`, on server-side sessions.
- **Audits** — `POST /api/audits` (anonymous, one-off) and the public `GET /api/audits/:uuid`. A BullMQ queue and a separate worker process run them with Playwright Chromium and vendored axe-core.
- **Pages** — `POST/GET /api/pages`, `PATCH/DELETE /api/pages/:id` and `GET /api/pages/:id/history`, all behind the auth middleware. Adding a page creates its `Site` if needed, enforces the per-account cap, and starts a first audit; `GET` answers the whole dashboard — latest audit, score, previous score and a bounded sparkline — in a fixed number of queries.

- **Daily re-audits** — a BullMQ job scheduler in the worker fans out one audit per monitored page every night, spread over a six-hour window by a per-domain offset. See *Re-audit scheduler* below.
- **Regression detection** — each tracked-page completion compares with its previous completed audit, records a score drop or newly severe rule, and dedupes alerts to one per page per UTC day. See *Regression detection* below.
- **Regression email** — a durable outbox dispatches those events through Resend (or the safe local console adapter), with provider retries and page-scoped one-click unsubscribe. See *Alert email* below.

Not built yet: every frontend screen. See `../DECISIONS.md` for stack decisions, `docs/superpowers/specs/` for designs and `docs/superpowers/plans/` for the plans they turned into.

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

**A connection that is merely still opening is not an outage.** The client is built with `enableOfflineQueue: false` so a dead Redis rejects instead of hanging, and ioredis draws no distinction between dead and not-yet-connected — so a command issued before the socket is writable used to fail, degrading the first request a process served for no reason but its own timing. `RedisTokenBucket` waits up to `READY_TIMEOUT_MS` for the connection first. An outage costs one such wait per degraded window, not one per request, because the first failure puts the limiter on its fallback for the next five seconds.

`TRUST_PROXY_HOPS` (default `0`) is how many reverse proxies sit in front of the process; Express reads the client IP from that many positions in `X-Forwarded-For`. It must be a real hop count, never `true` — see the comment in `main/config/app.ts`.

Every bucket except the anonymous audit one is a constant in `main/config/rate-limits.ts`. The audit bucket is env-configurable because it is the cost dial: `AUDIT_RATE_CAPACITY` (default `5`) and `AUDIT_RATE_PER_HOUR` (default `5`).

## Audit worker

The `audit` queue runs accessibility audits: navigate with Chromium, inject vendored axe-core, store violations, and score the page. `pnpm dev:worker` consumes `ping`, `audit`, `reaudit` and `alert-email`.

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

## Regression detection

Successful tracked-page audits are completed and evaluated in one Postgres transaction. The claim-fenced `done` update runs first; only its owner may compare the result or emit an event. The baseline is the latest earlier `done` audit by `(created_at, id)`, so failed audits are skipped and jobs finishing out of order cannot compare time backwards. Anonymous and first audits never alert.

`domain/services/regression.ts` owns the rule-level policy shared with the future audit diff UI (#22): a newly added `serious` or `critical` rule wins over a simultaneous score drop, while an axe-version change suppresses both signals. Improvements do not alert.

`alert_events_one_per_page_per_day` is the authority for the one-alert-per-UTC-day rule. The insert names that expression index as its exact `ON CONFLICT DO NOTHING` target, so two completions racing for the same page resolve normally while foreign-key and check errors still fail. `emailed_at` remains null until the email provider confirms acceptance.

## Alert email

`alert_events` is the durable outbox. Once a minute, a BullMQ scheduler walks every row with `emailed_at is null` **and** `failed_at is null` and enqueues one deterministic `send` job per event. The send job never runs regression detection again: it loads that exact event, builds a plain-text comparison, and stamps `emailed_at` only after a real provider confirms acceptance. A Redis outage cannot lose the event; the next dispatch sees it again. If a job exhausts its attempts, the dispatcher revives that retained failed record and resets its allowance — a plain duplicate `add` would leave it failed for the retention period and strand the outbox row.

`previewed_at`, `emailed_at`, `failed_at` and `failure_reason` are the delivery-state facts on the row, not guesses from BullMQ retention. `previewed_at` is the durable at-most-once claim acquired before the safe local console adapter writes the message. Only the worker that wins that conditional claim may emit the preview. A crash after the claim can therefore omit a preview, but cannot repeat one; exactly-once output is impossible across PostgreSQL and stdout. The claim suppresses repeated preview-mode dispatch, but it does **not** claim provider delivery and does **not** block a later real send. `emailed_at` means a real provider accepted the request, so delivery is complete. `failed_at` paired with `failure_reason` means delivery hit a deliberate terminal stop and the minute dispatcher now leaves that row alone until an operator clears it.

`MAIL_DRIVER=console` is the default and never contacts an email service. It claims the preview in `previewed_at` before writing it to the log and deliberately leaves `emailed_at` null. Production must explicitly select `resend` and provide `RESEND_API_KEY`; when that switch is made, the dispatcher revives any retained completed preview jobs immediately. Resend requests carry `Idempotency-Key: alert-event/<id>` so a worker that loses the provider's response can repeat the request without repeating the email inside Resend's 24-hour idempotency window.

The deliberate manual retry, only after the operator has repaired the configuration that caused the failure, is:

```sql
update alert_events
set failed_at = null, failure_reason = null
where id = $1 and emailed_at is null;
```

That scope is the safety boundary: clear one known event, or a bulk set chosen explicitly by the operator, and let the normal dispatcher pick it up again. Bulk retry must always use an operator-chosen predicate and must never happen automatically on deploy. There is no public retry endpoint.

### Coordinated rollback

Migration 009 never auto-discards preview or terminal delivery state. Its downgrade refuses to run while any `previewed_at`, `failed_at`, or `failure_reason` value remains. To deliberately return to workers that do not understand this state, first stop the alert-email workers so they cannot write more of it, then inspect and resolve the affected events. Only after accepting that the older workers may preview or deliver those events again, explicitly erase that metadata for the selected rows:

```sql
update alert_events
set previewed_at = null, failed_at = null, failure_reason = null
where id = $1;
```

This is coordinated rollback metadata erasure after workers stop, not the manual retry operation above: it intentionally includes a previewed event that was later delivered. Use an operator-chosen predicate for any bulk operation. Once no delivery-state values remain, the migration can be downgraded; it will never silently erase them.

Every message carries `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The URL is authenticated by an HMAC token scoped to the page, so the POST works without a session. A normal browser GET displays a confirmation form rather than changing state on navigation — mail scanners follow links, and a state-changing GET would unsubscribe people who never clicked. Unsubscribing flips `pages.alerts_enabled`; `monitoring_enabled` remains on, preserving daily audits and history. Existing unsent events remain honest (`emailed_at` stays null) but fall out of the dispatch query, and a send job already queued checks the preference again before contacting the provider.

### Production deliverability checklist

Code cannot configure DNS or prove inbox placement. Before `MAIL_DRIVER=resend` is enabled:

1. Add and verify a dedicated sending subdomain in Resend (for example `alerts.tabstop.dev`) and set `MAIL_FROM` to an address on it.
2. Publish the SPF and DKIM records Resend supplies.
3. Publish DMARC at `_dmarc.tabstop.dev`, beginning with `p=none` and a monitored `rua`, then tighten to `quarantine` or `reject` after every legitimate sender is aligned.
4. Disable provider click rewriting; product attribution is the `utm_source=alert_email` query parameter.
5. Send to real Gmail and Yahoo/Outlook inboxes, inspect the received headers for `spf=pass`, `dkim=pass`, and `dmarc=pass`, and exercise the one-click unsubscribe header.

As of 2026-07-30, public DNS returned none of those records. This checklist is therefore a deployment prerequisite, not a completed claim.

## Re-audit scheduler

The nightly fan-out that makes this a monitoring product rather than a one-off audit tool. It runs in the **worker**, on the `reaudit` queue, at `0 2 * * *` **UTC** — a BullMQ job scheduler, so it fires once however many worker replicas are running. The handler enqueues onto the same `audit` queue everything else uses, so re-audits and one-off submissions share one concurrency cap and one worker pool.

- **Jitter is deterministic per page**, not random: FNV-1a over the host gives the domain's base offset, and FNV-1a over the page id picks a one-minute slot within a six-hour window. Both come from *identity* rather than from position in the run — a positional stagger shifts when a sibling is paused and resets on retry, so a page's audit time would move between nights and its trend line would stop being comparable, which is the whole reason this is a hash. `domain/services/reaudit-schedule.ts`, pure and dependency-free. It spreads load and holds each page at a consistent hour; it does **not** guarantee two audits of one host never overlap, which is #41's job at the worker.
- **Exactly one audit per page per UTC day, in two layers.** The eligibility query skips pages with an audit in flight or one created since midnight UTC. Underneath it, `audits_one_scheduled_per_page_per_day` — a partial unique index on `(page_id, scheduled_for)` — makes it true regardless: two overlapping runs both select the page, and the second insert returns no row.
- **`scheduled_for` is the run's day, stamped by the scheduler and nothing else.** Deriving it from `created_at` would have constrained *manual* re-audits to one per page per day too, and would split a fan-out that crosses midnight across two days. The column is write-only: node-postgres parses a `date` at local midnight, so nothing reads it back.
- **A failed enqueue deletes its audit row.** A queued audit nothing will run shows as permanently in progress, and it keeps its page out of the worklist. An *unconfirmed* enqueue keeps the row — the queue may have taken the job and lost the reply.
- **Rows that get stranded anyway are reclaimed, by asking the queue rather than by ageing them out.** Each run first retires unfinished audits that are old *and* whose job is no longer *pending*, marking them `failed`. Pending, not merely present: BullMQ keeps a failed job for a day and a completed one for an hour, so "a record exists" would read that retention as work still to come. Ageing them out on a timer instead would compound under load: on a queue that hasn't drained, every real pending audit looks abandoned too, so its page is scheduled again and each night piles onto the backlog. The lookup fails **closed** — an unreachable queue means "still live" — because the alternative manufactures duplicate work out of healthy rows. `abandonedReclaimed` in the summary should be zero; a rising number means enqueues are being lost.
- **The run stops on shutdown.** A full fan-out is far longer than the worker's shutdown grace, so `SIGTERM` aborts it at the next page rather than hitting the force-exit timer mid-page — which is one way rows get stranded in the first place.
- **A run that did not finish fails its job**, rather than logging `truncated` and reporting success — otherwise it is invisible to every queue dashboard. The retry then starts on the tail, because the pages the first attempt scheduled have dropped out of the worklist. A run cut short by shutdown is the exception: it succeeds, since retries would go to a worker that is leaving.
- **The run pages through the worklist**, keyset by page id, rather than taking one capped batch. A cap would drop the same tail every night — those accounts would stop being monitored with nothing failing anywhere. `truncated` in the summary is a circuit breaker at 50,000 pages, not a routine outcome.
- **Every run logs one structured line**, `{"event":"reaudit-run", ...}`, including the nights it finds nothing to do and the ones that ended badly (`outcome` is `completed` or `aborted`). A summary that only appears when there is work is one nobody notices the absence of, and a scheduler that stops firing breaks this product silently. Watch `reclaimFailures` as well as `abandonedReclaimed`: the first says the reclaim pass could not run, which looks identical to a healthy night in every other number. #25 forwards it to PostHog.
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

Seven tables, across nine migrations in `src/infra/db/postgres/migrations/`:

| Table | Notes |
|---|---|
| `users` | `email` is stored lowercased; `alert_threshold` (score points) is read by regression detection |
| `sessions` | primary key **is** the cookie value; `expires_at` is filtered in SQL so no caller can forget it |
| `sites` | `unique (user_id, domain)`; deleting a user cascades all the way down |
| `pages` | `unique (site_id, url)`; `monitoring_enabled` controls daily audits while `alerts_enabled` controls mail independently; deleting a page cascades to everything below |
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
