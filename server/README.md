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

Only the `GET /api/health` slice exists so far, now including a Postgres reachability probe. No application tables exist yet — the schema lands with the data model in #4. See `../DECISIONS.md` for stack decisions and `docs/superpowers/specs/` for designs.

## Stack

Express 5 · TypeScript 7 · Kysely + Postgres · Vitest + Supertest + Testcontainers · pnpm.

Deliberately excluded to keep this minimal, same reasoning as the template: no `dotenv`, no `cors` package, no ESLint (`typescript-eslint` doesn't support TS 7 yet), no validation layer — added per-usecase as soon as something real needs them.

## Conventions

- **`type: module` + `NodeNext` resolution**: relative imports need an explicit `.js` extension even though the source file is `.ts` (e.g. `import { x } from './x.js'` from `x.ts`).
- One usecase = one file per layer + one factory + one route, named identically across layers. Grep the usecase name to find every file that makes it up.

## Commands

```bash
pnpm install
docker compose up -d   # local Postgres, required by pnpm dev
pnpm migrate           # run migrations
pnpm dev          # tsx watch, loads .env
pnpm test         # requires Docker: starts a throwaway Postgres per run
pnpm test:watch
pnpm typecheck
pnpm build         # tsc -> dist/
pnpm start          # run built output
```

Copy `.env.example` to `.env` before running.

## Database

Kysely over `pg`. `makeDatabase(url)` in `infra/db/postgres/helpers/` is a pure factory; the single long-lived instance lives in `main/config/database.ts`. Adapters receive `Kysely<Database>` through their constructor — they never reach for a global.

Migrations are registered in `infra/db/postgres/migrations/index.ts` rather than discovered from disk, because Kysely's `FileMigrationProvider` resolves paths relative to `__dirname`, which differs between `tsx`, `dist/`, and Vitest under `"type": "module"`.

Note the migration API is imported from the `kysely/migration` subpath; importing it from `kysely` fails typecheck by design.
