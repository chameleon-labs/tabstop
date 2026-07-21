# Decisions

A running log of product and engineering decisions — what was chosen, what was deferred, and why. Newest first.

Format: **date · decision · why · what was rejected/deferred**.

---

## 2026-07-20 — correlate score drops with product metrics (deferred)

Idea (from a friend, relayed via voice note): when a page's score drops, cross-reference the customer's own PostHog data for a conversion/funnel metric on a relevant segment (e.g. checkout conversion among keyboard-only users) — "this regression cost you 7% conversion," not just "your score dropped."

Why deferred: strong positioning — ties the score to revenue instead of compliance — but it means reading a customer's own analytics: OAuth into their PostHog project, querying their events, a real trust/access surface. That's a v2+ integration for once tabstop has real users, not a v1 feature. Revisit after the funnel-driven iteration weeks (Phase 2, Wk 11–12) show whether existing users would actually want it.

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
