/**
 * When the nightly run should actually fetch each page.
 *
 * Two things have to be true at once. Tabstop must not arrive at one origin
 * with every page it tracks for that origin at the same instant, and it must
 * not land its whole night's work in a single spike of its own. Both are
 * solved by spreading the run over a window - the only question is how the
 * offset is chosen.
 *
 * DETERMINISTICALLY, from the domain. Random jitter would spread the load
 * equally well and would move every page's audit time every night, so a page's
 * own trend line would compare 03:00 on Monday against 07:00 on Tuesday. For
 * a product whose entire output is "did this get worse", a measurement whose
 * conditions wander is worth less than one taken at a consistent hour.
 */

/** Six hours. Long enough to flatten the spike, short enough to be "nightly". */
export const JITTER_WINDOW_MS = 6 * 60 * 60 * 1000

/**
 * Pages on ONE domain share a base offset, so without this they would all
 * arrive together - the per-origin politeness this exists for, missed by the
 * jitter that was supposed to provide it. A minute apart is enough for a
 * monitored page load and leaves the account's pages inside one browsing
 * session of each other.
 */
export const SAME_DOMAIN_STAGGER_MS = 60_000

const FNV_OFFSET_BASIS = 2166136261
const FNV_PRIME = 16777619

/**
 * FNV-1a, 32-bit, rather than the sha256 #13 sketched.
 *
 * Two reasons, and the second is the binding one. Nothing here needs a
 * cryptographic property: an attacker who learns which minute their own page
 * is audited gains nothing, and one who wants to collide two domains onto the
 * same slot has achieved a minute of shared load. And `domain/` may import
 * NOTHING, not even node: builtins - a rule `architecture.spec.ts` enforces -
 * so reaching for `node:crypto` here would mean either breaking that boundary
 * or introducing a port for a hash whose only requirement is that it spreads.
 *
 * `Math.imul` because the multiply overflows 32 bits on every round and plain
 * `*` would silently drift into float territory, which is how a hash stops
 * being uniform. Read as UTF-16 code units, which is exact for the hostnames
 * this sees: they are ASCII, since anything else arrives already punycoded.
 */
const fnv1a = (value: string): number => {
  let hash = FNV_OFFSET_BASIS
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  // Unsigned: Math.imul yields a signed 32-bit result, and a negative offset
  // would be a delay in the past - which BullMQ runs immediately, collapsing
  // the spread this function exists to create.
  return hash >>> 0
}

/**
 * How long after the run starts this page should be fetched.
 *
 * `position` is the page's index among the pages this run holds for the same
 * domain, so the whole domain is serialised rather than fired at once. The
 * modulo wraps rather than clamps: a domain with more pages than the window
 * has stagger slots keeps spreading them across the window instead of piling
 * every page past the edge onto the same final instant - which is exactly the
 * simultaneous arrival the stagger exists to prevent.
 */
export const reauditDelayMs = (
  domain: string,
  position: number,
  windowMs: number = JITTER_WINDOW_MS,
  staggerMs: number = SAME_DOMAIN_STAGGER_MS
): number => (fnv1a(domain) + position * staggerMs) % windowMs

/** The UTC calendar day, as Postgres wants a `date`. */
export const utcDay = (at: Date): string => at.toISOString().slice(0, 10)

/**
 * Midnight UTC of the day `at` falls in.
 *
 * The floor for "has this page been audited today". UTC because the schedule
 * is UTC: a local-midnight boundary would move with the deployment's timezone
 * and shift the day the run is deduping against.
 */
export const utcDayStart = (at: Date): Date => new Date(`${utcDay(at)}T00:00:00.000Z`)
