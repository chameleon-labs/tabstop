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

Only the `GET /api/health` slice exists so far, now including a Postgres reachability probe. A BullMQ queue and a separate worker process are also wired up: the worker consumes the `ping` heartbeat queue, and jobs are currently enqueued by the test suite and by hand — nothing in production enqueues one yet. A scheduled producer arrives with cron support. No real job (the audit worker) exists yet. No application tables exist yet — the schema lands with the data model in #4. See `../DECISIONS.md` for stack decisions and `docs/superpowers/specs/` for designs.

## Stack

Express 5 · TypeScript 7 · Kysely + Postgres · BullMQ + Redis · Vitest + Supertest + Testcontainers · pnpm.

Deliberately excluded to keep this minimal, same reasoning as the template: no `dotenv`, no `cors` package, no ESLint (`typescript-eslint` doesn't support TS 7 yet), no validation layer — added per-usecase as soon as something real needs them.

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

Copy `.env.example` to `.env` before running. That copy only happens once: if your checkout has an older `.env` predating a variable added to `.env.example` (e.g. `REDIS_URL`), re-diff the two by hand after pulling — nothing will do it for you, and the failure mode is an opaque `... is required but was not set` at startup.

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
