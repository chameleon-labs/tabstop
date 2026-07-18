# tabstop

> Paste a URL, get an accessibility audit and a score. Track the pages you care about, and tabstop re-audits them daily, charts the score over time, and emails you the day a deploy makes things worse.

**Status: early development — building in public.** Follow along via [DECISIONS.md](./DECISIONS.md).

## Why

CI catches accessibility regressions *if you set it up* — and almost nobody sets it up. Existing options each miss the mark for small teams:

- **Lighthouse CI / axe in CI** need pipeline integration and engineering buy-in.
- **pa11y-dashboard** is self-hosted and aging.
- **Commercial monitors** (axe Monitor, SiteImprove) start with a sales call.

tabstop is the zero-setup version: **monitoring, not gating**. Paste a URL and you have a baseline in thirty seconds.

I contribute to [Ariakit](https://github.com/ariakit/ariakit), an accessibility-focused UI component library. This is the monitoring tool I kept wishing the people using it had.

## How it works

- Audits run real Chromium via Playwright with [axe-core](https://github.com/dequelabs/axe-core) injected — the same engine behind most a11y tooling.
- Each audit produces a violation list (grouped by impact, with selectors and fix links) and a **score** designed for trending. The score formula is opinionated and will be documented on its own page — the violation list is for fixing; the score is for noticing regressions.
- Monitored pages are re-audited daily; a score drop or any new `serious`/`critical` violation triggers one email.

## v1 scope

Single public URLs (no crawling), Chromium only, daily cadence, email alerts, public shareable result pages.

**Deliberately not in v1** (roadmap, in rough order): site crawling · authenticated pages · CI integration + API tokens · viewport matrix · teams · Slack alerts · WCAG level configuration.

## Stack

Django + DRF · Postgres · Celery + Redis · Playwright + axe-core · React + Vite + TypeScript.

## License

[MIT](./LICENSE)
