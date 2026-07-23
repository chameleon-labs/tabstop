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

Only the template's `GET /api/health` slice exists so far — this repo is being scaffolded before the actual audit/score domain logic is designed. See `../DECISIONS.md` for the backend stack decision and `docs/superpowers/specs/2026-07-22-server-scaffold-design.md` for the scaffold design.

## Stack

Express 5 · TypeScript 7 · Vitest + Supertest · pnpm.

Deliberately excluded to keep this minimal, same reasoning as the template: no database driver, no `dotenv`, no `cors` package, no ESLint (`typescript-eslint` doesn't support TS 7 yet), no validation layer — added per-usecase as soon as something real needs them.

## Conventions

- **`type: module` + `NodeNext` resolution**: relative imports need an explicit `.js` extension even though the source file is `.ts` (e.g. `import { x } from './x.js'` from `x.ts`).
- One usecase = one file per layer + one factory + one route, named identically across layers. Grep the usecase name to find every file that makes it up.

## Commands

```bash
pnpm install
pnpm dev          # tsx watch, loads .env
pnpm test         # vitest run (unit + integration)
pnpm test:watch
pnpm typecheck
pnpm build         # tsc -> dist/
pnpm start          # run built output
```

Copy `.env.example` to `.env` before running.
