# Decisions

A running log of product and engineering decisions — what was chosen, what was deferred, and why. Newest first.

Format: **date · decision · why · what was rejected/deferred**.

---

## 2026-07-26 — the schema, and four things the issue got wrong

Five tables — `sites`, `pages`, `audits`, `violations`, `alert_events` — in one migration. Domain models stay camelCase and persistence-free; repositories own the snake_case translation, matching the constructor-injection decision from the Postgres wiring entry below.

**Anonymous audits are the product's hook, so `audits.page_id` is nullable.** A one-off is an audit with no page, addressed by an unguessable `public_uuid` that is separate from the `bigserial` primary key: internal joins stay cheap, and the world never sees a sequential id it could enumerate.

Four corrections to the shape the issue proposed, all found by running it rather than reading it:

1. **The daily alert dedupe index could not be created at all.** `(page_id, (emailed_at::date))` is rejected — casting a `timestamptz` to `date` is STABLE, not IMMUTABLE, because it depends on the session `TimeZone`. Pinning the zone fixes it, and makes the dedupe window explicitly a **UTC** day.
2. **The dedupe was keyed on the wrong column, and `emailed_at` was not nullable.** Regression detection records an `AlertEvent`; sending the email is a separate, later step that must set `emailed_at` only on a confirmed send and leave it null when delivery fails — otherwise the send job cannot find the alerts it still owes. A `not null default now()` marked every event as already delivered the moment it was created, making retries impossible.

   Simply making the column nullable would have been worse than the original bug: **NULLs never collide in a unique index**, so the dedupe would have silently permitted unlimited duplicate alerts for exactly the unsent rows it exists to catch — verified, three unsent alerts for one page all accepted. So `alert_events` now carries a separate `created_at`, and the dedupe keys on that. That is also the right meaning: whether a page has already alerted today is a fact about detection, not about whether an email provider happened to accept the message.
3. **`counts_by_impact` defaulted to `'{}'` while the domain type declared `Record<Impact, number>`** — so every queued audit would have violated its own type. The default is now all-zeros, and a check constraint (`?& array[...]`) makes the type true by construction instead of by convention, since jsonb enforces no shape of its own.
4. **jsonb writes must be stringified.** node-postgres serialises a plain object as JSON but an array as a Postgres array literal, which the jsonb parser rejects. So `counts_by_impact` would have worked and `violations.nodes` would have failed at runtime — the worst kind of half-truth. Every jsonb column is typed to require a string on insert, which makes the compiler enforce it. Worth knowing for specs too: jsonb does not preserve key order, so jsonb values must be compared structurally rather than as serialised JSON.

Also decided: deleting a page **cascades** to its audits, violations and alert events, which means its public share links stop resolving. That is the intended privacy behaviour — a user who deletes a tracked page should not leave working public URLs exposing that page's failures. `alert_events.previous_audit_id` is the one exception, `on delete set null`, because an alert is about its *current* audit and must survive retention deleting the older one it compared against.

Scope deliberately left out: repositories for `Site`, `Page` and `AlertEvent`. They have no caller until the pages API and regression detection exist, and a query shape written months before its first use is written against a guess — the same reasoning that kept a queue singleton out of the job-runtime work. The obligations were recorded as comments on the issues that inherit them rather than only here.

## 2026-07-26 — background jobs run on BullMQ, and Redis is the price

Audits take ~30 seconds of real compute, so they cannot run inside an HTTP request. `POST /api/audits` will return 202 and hand the work to a BullMQ queue consumed by a separate worker process.

Rejected: **pg-boss**, which is Postgres-backed and would have added no new infrastructure at all — the strongest argument on the table, and declined deliberately. **Graphile Worker**, also Postgres-backed, but still 0.x and it pulls a config/CLI surface this project does not need.

Why BullMQ anyway: it is the most widely used Node queue, and on a solo-operated product the ability to reason about the queue at 2am outweighs one fewer service to run. Its concurrency and rate-limiting primitives are also the most mature of the three, which matters directly for the audit worker's cost controls.

**Redis is accepted knowingly as a second datastore.** That is the cost of this choice, and it lands on local development, CI, and deploy. Recording it here because "why not the Postgres-backed one, when Postgres was right there" is the obvious question to ask of this repo later, and the answer should not be that nobody considered it.

Also decided: no `queue` field on `/api/health`. A health endpoint that fails because a dependency is unreachable is a deep health check, and its failure mode is correlated — Redis blips, every instance reports unhealthy at once, and a partial degradation becomes a total outage. The same critique applies to the `database` field already shipped, and revisiting it is deferred to the deploy issue, where the platform's actual restart and readiness semantics are known rather than guessed at.

Two implementation notes worth keeping: BullMQ has no per-job timeout of any kind, so handlers supply their own via an `AbortSignal` that is passed into the handler rather than raced around it — otherwise a timed-out job leaves its work running. And `lockDuration` defaults to 30 seconds while an audit takes about that long; automatic lock renewal is the only reason the default is safe, so the audit worker should set it explicitly rather than inherit it.

## 2026-07-25 — Postgres via Kysely, wired behind constructor injection

Kysely (query builder over `pg`) is the database client, wired into `server/` behind protocols in `data/protocols/db/`. Proven by a reachability probe on `GET /api/health`; no application tables exist yet.

Why Kysely: it returns plain objects, so mapping to domain models at the infra boundary stays explicit and persistence types cannot quietly become domain types. Rejected: Drizzle (its inferred row types are convenient enough that skipping the mapping becomes tempting), raw `pg` with hand-written SQL (nothing verifies the declared row type matches the query), and Prisma (a generated client plus query-engine binary is the hardest to hide behind a protocol, and adds a codegen step to CI and to the worker image that already carries Playwright).

Two deliberate departures from the reference implementation of this template, [georgekaran/survey-server](https://github.com/georgekaran/survey-server):

1. **Constructor injection, not a static helper.** `AccountMongoRepository` calls `MongoHelper.getCollection()` from inside itself — a service locator, which hides the dependency and needs global state in tests. That was justified there because `getCollection()` carries lazy-reconnect logic and had to be reachable from within the repository; `pg`'s pool reconnects internally, so a Kysely instance is an inert handle that can simply be passed in. The singleton lives in `main/config/database.ts`, where wiring state belongs.

2. **A dead database degrades rather than prevents boot.** `survey-server` chains `connect().then(listen)`, so a failed connection means nothing ever listens. Here the process starts and `/api/health` returns 503 with `database: "down"`. Since the deploy health check will point at that endpoint, an honest 503 stops traffic being routed while keeping the container alive and its logs readable. Missing `DATABASE_URL` is still fatal at boot: bad configuration should fail fast, unreachable infrastructure should not.

Manual verification turned up a defect in that second decision: `pg.Pool` emits an `'error'` event for idle clients when the backend terminates them (Postgres code `57P01` — a database restart, or an operator dropping the connection), and with no listener attached, Node treats that as fatal and kills the process. That's the exact scenario the degrade-don't-die decision exists to handle, so the one case it was meant to survive was the one crashing the server. The whole suite was green and typecheck was clean the entire time this was broken — it only surfaced by actually killing a connection and watching what happened. Fixed with a log-and-swallow `pool.on('error')` handler in `makeDatabase`, covered by a regression spec that terminates a backend via `pg_terminate_backend` and asserts the process survives. Graceful shutdown also closes idle connections up front and carries an `unref()`'d 10-second force-exit backstop that exits non-zero, so a drain that hangs can't silently skip closing the pool.

Also decided: migrations are registered in a typechecked object literal rather than discovered by `FileMigrationProvider`, whose `__dirname`-relative resolution differs across `tsx`, `dist/`, and Vitest under `"type": "module"`. Integration specs get a real database from Testcontainers via Vitest `globalSetup`, so `pnpm test` needs Docker and exercises migrations on every run.

Still deferred: the job runtime, email delivery, and the audit worker's integration into the layered structure.

## 2026-07-22 — backend is Node/TS, not Django

Scaffolded `server/` from [chameleon-labs/clean-node-template](https://github.com/chameleon-labs/clean-node-template) (Express, Clean Architecture layering, TypeScript 7, pnpm 11, Node 24, Vitest) — no code existed under the previously-named Django+DRF stack, so this is a stack pick, not a migration.

Why: consolidates on a single language across this whole codebase and George's actual 8y depth (Node/TS), rather than splitting focus across two ecosystems for a solo build.

What was deferred, same "no speculative code" principle as the template: Postgres client/ORM, what replaces a Celery+Redis-style scheduler for daily re-audits, email delivery, and the Playwright/axe-core audit worker's integration into the layered structure. Only the template's own `health-check` vertical slice ships for now — none of tabstop's actual audit/score domain logic is part of this pass.

## 2026-07-20 — correlate score drops with product metrics (deferred)

Idea (from a friend, relayed via voice note): when a page's score drops, cross-reference the customer's own PostHog data for a conversion/funnel metric on a relevant segment (e.g. checkout conversion among keyboard-only users) — "this regression cost you 7% conversion," not just "your score dropped."

Why deferred: strong positioning — ties the score to revenue instead of compliance — but it means reading a customer's own analytics: OAuth into their PostHog project, querying their events, a real trust/access surface. That's a v2+ integration for once tabstop has real users, not a v1 feature. Revisit once there's actual usage data suggesting demand for it.

## 2026-07-20 — deploy-webhook trigger (elaborates the CI/API-tokens defer below)

Idea (same source): instead of pasting a URL, a customer's deploy pipeline POSTs a webhook to tabstop on deploy; tabstop scans automatically, diffs against the previous baseline, and alerts on regression with no manual step.

Why deferred: this is the "CI integration / API tokens" item already deferred below, just with the mechanics spelled out (webhook in, not an API key pull). Good v2 shape — keep this exact framing for when it's built — but v1's whole pitch is zero-setup, and wiring into someone's deploy pipeline is setup.

## 2026-07-18 — v1 scope is a contract

Ship: paste-a-URL audits (no signup), saved pages with daily re-audits, score trend per page, regression emails, public shareable results.

Defer: crawling, authenticated pages, CI/API tokens, viewport matrix, teams, Slack, WCAG level config. Each of these is a cut line — when a week runs over, the roadmap grows and v1 does not.

Why: the product's promise is *zero-setup monitoring*. Every deferred item adds setup or surface area before the core promise is proven.

## 2026-07-18 — vendor axe-core, don't wrap it

The audit worker injects a vendored `axe.min.js` into the page via Playwright rather than depending on a wrapper library.

Why: one fewer dependency between us and the engine, and full control over the axe version we report against (`axe_version` is stored on every audit — scores are only comparable within an engine version).

## 2026-07-18 — the score is for trending, not judging

axe-core deliberately doesn't produce a score, so ours is opinionated: weighted deductions by impact, per-rule element counts capped so one repeated unlabeled icon can't zero a page. Raw counts by impact are always shown next to the score.

Why: a single number is what makes *regression* visible at a glance; the violation list is what makes fixing possible. Conflating the two is how scores get gamed or dismissed.
