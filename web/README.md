# tabstop web

React + Vite + TypeScript frontend. Talks to `../server` over HTTP and shares its response types through `../contract`.

## Current state

**A scaffold.** The four v1 routes resolve to placeholder screens; the shell, routing, error handling, API client and data-fetching setup underneath them are real.

| Route | Screen | Implemented by |
|---|---|---|
| `/` | Home — paste a URL, watch the audit | #19 |
| `/dashboard` | Monitored pages | #20 |
| `/pages/:id` | Score trend + violation detail | #21 |
| `/r/:uuid` | Public share page — **unauthenticated** | #23 |

There is deliberately **no component library and no design system** here. Build four screens, then extract if it ever earns its keep.

## Stack

React 19 · Vite 8 · TypeScript 7 · React Router 8 (data router) · TanStack Query 5 · Vitest + Testing Library + jsdom · plain CSS.

No CSS framework and no headless-component library yet. When one is needed, it must not fight semantic markup or focus management — this is an accessibility product and the UI is the demo, so nothing that renders a `div` where a `button` belongs.

## Layout

```
src/
  main.tsx                    browser entry — the only place a QueryClient is built for real
  app.tsx                     providers; takes the QueryClient as a prop so specs get their own
  routes.tsx                  the route table, as data so a spec can mount the real thing
  api/
    client.ts                 the only place that calls fetch
    query-client.ts           retry policy
    audits.ts                 audit query + mutation hooks
    session.ts                who is signed in
  hooks/
    use-document-title.ts
  components/
    Layout/                   shell: skip link, header, route announcer, <Outlet />
    NotFound/
    RequireAuth/              the session gate
    RouteAnnouncer/
    RouteError/               the error boundary element
  screens/
    Home/  Dashboard/  PageDetail/  Share/
  test/
    http.ts                   response builders, free of React
    render.tsx                mounts the real route table, or a component in providers
```

**Every component is a folder holding `index.tsx` and `index.spec.tsx`,** named in PascalCase after the component. A component and its test move together, and the import is the folder (`from '../NotFound'`). Hooks are not components and live in `hooks/`, named for the file rather than a folder — `useDocumentTitle` is imported by every screen while only the shell renders the announcer it feeds, so bundling it into a component folder would have made five screens import a component directory to get a hook.

**Props are always a named, exported type** — `RequireAuthProps`, `AppProps`, `ErrorPageProps` — never inlined into the signature. It gives consumers something to reference, and keeps the signature readable once a component has more than one prop.

## Commands

Identical names to `../server`, so one CI workflow shape covers both.

| | |
|---|---|
| `pnpm dev` | Vite dev server on :5173, proxying `/api` to :3000 |
| `pnpm build` | `tsc --noEmit` then `vite build` — a type error fails the build |
| `pnpm test` | Vitest, jsdom |
| `pnpm test:watch` | the same, watching |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm preview` | serve the built bundle |

Install from the repository root (`pnpm install`), not from here — this is one project in a pnpm workspace.

## Talking to the server

**Every request carries `credentials: 'include'`, and it is not per-call opt-in.** The session is an httpOnly cookie; `fetch` does not send cookies cross-origin without it, and `app.tabstop.dev` → `api.tabstop.dev` is same-*site* (which is what makes `SameSite=Lax` work) but still cross-*origin*. Omit it once and a valid session returns 401 while looking exactly like a backend bug.

**The frontend cannot read the session.** `httpOnly` means JavaScript never sees the cookie, so there is no local check for "am I signed in" — `GET /api/me` is the only answer, and `useSession` is the only caller. A 401 from it is mapped to `null`, because "nobody is signed in" is an answer; a 500 stays an error, so a broken backend does not read as a logged-out user and bounce everybody.

**Error bodies are validated at runtime; success bodies are not.** A success body is described by `@tabstop/contract`, and the server's typecheck fails if its mappers stop matching it, so re-validating in the browser would ship a duplicate of a guarantee that already exists. An error body has no such guarantee — a 502 from a proxy is an HTML page nobody wrote — and we *branch* on those: a 429's `resetAt` becomes a countdown, a 409's `code` picks a screen. `rateLimitOf` and `conflictOf` in `api/client.ts` check every field they promise.

**`nodes[].html` is a markup snippet captured from an arbitrary third-party page.** It is displayed as text, never as markup. React escapes by default, so the whole rule is that `dangerouslySetInnerHTML` never touches it. This is the exposure that motivated an httpOnly cookie over a JS-readable token.

**Polling comes from the server.** `POST /api/audits` returns `pollAfterMs`; pass it to `useAudit` rather than choosing a number, so the interval can be widened without a frontend deploy. `useAudit` returns `false` from `refetchInterval` once the audit is `done` or `failed`, which is the entire stop condition — no component owns a timer.

## Development against a real server

`pnpm dev` **from the repository root** starts the API and this together, each line prefixed with the project it came from. Two terminals still work if you prefer them separate:

```
cd ../server && pnpm dev      # terminal 1
pnpm dev                      # terminal 2
```

Neither form starts the audit **worker** — no audit will ever leave `queued` without `pnpm dev:worker` in `../server`.

`vite.config.ts` proxies `/api` to `http://localhost:3000`, and that proxy is what makes the session cookie work locally. The mechanism is the **request URL**, not a header: `Set-Cookie` carries no `Domain`, so the browser scopes the cookie to the host it asked — `localhost:5173` — and returns it on every same-origin call. Point the app straight at `localhost:3000` instead and the cookie belongs to a different origin, where cross-site rules start deciding whether it travels.

**When the API is unreachable you get one line, not a stack per request.** A server that fails to boot is the usual reason, and in a merged stream Vite's default logging buries the server's own error under it — 48 ECONNREFUSED stacks in fifteen seconds, measured. `reportProxyOutage` prints once and names the likely cause; `quietProxyErrors` drops the repeats. The latch clears on the first successful response, so a second outage is reported as loudly as the first.

What the server needs before anything here works:

- **`FRONTEND_ORIGIN=http://localhost:5173`** in `server/.env`. It is required at startup — the server refuses to boot without it — and it is what `same-origin.ts` compares the `Origin` header against, so a POST from a Vite dev server on any other port is rejected as cross-origin. `server/.env.example` already has the right value; a `.env` predating `web/` will not.
- A database and Redis: `docker compose up -d` in `../server`, then `pnpm migrate`.

`VITE_API_URL` is unset in development on purpose, which makes every request same-origin and sends it through the proxy. A deployed build sets it to the real API origin. Override the proxy target with `VITE_DEV_API_TARGET` if the server is somewhere else.

## Accessibility in the shell

The parts that are easy to omit and hard to retrofit, so they are here from the first commit:

- **Skip link**, first in the DOM, visible on focus. `<main>` carries `tabIndex={-1}` — without it the browser moves the scroll position but not focus, and the next Tab starts from the top again.
- **Route announcer.** A client-side navigation announces nothing at all; a screen reader user follows a link and hears silence. `RouteAnnouncer` reads `document.title` into a polite live region after each route change — deferred, both because the destination screen has not set its title yet and because a live region has to be present and empty before content lands in it. It stays quiet on first load, which the browser already announced.
- **`useDocumentTitle` on every screen**, so the tab, the history entry and the announcement can never disagree.
- **Error boundary inside the shell.** `errorElement` lives on a pathless route one level below the layout, not on the layout itself — an `errorElement` renders *in place of* the route that declares it, so putting one on the layout replaces the header, the skip link and every way out. A spec asserts the skip link survives a failed screen.

## Testing

Specs mount the app's **real route table** (`test/render.tsx`) rather than a copy written in the test — the point is to assert that our configuration resolves the way we think, not that React Router works. For a single component, `Providers` from the same file supplies the router and query client it needs to render at all.

Queries are by role and accessible name. That is not only house style here: a test that can only find an element by `data-testid` is a test that would pass if the element stopped being reachable by anyone using a screen reader.

**Every assertion is mutation-checked** — break the line it covers, watch it go red, put it back. Three of these tests passed against a broken implementation when first written and had to be rewritten: one drove `window.history`, which a memory router does not listen to, so removing `replace` changed nothing; one threw a `Response` from a route element, where React Router does not convert it, so the branch it claimed to cover was never reached; one mounted the app at `/`, where nothing calls `useQuery`, so deleting the `QueryClientProvider` left it green. A test nobody has watched fail is a guess.
