/**
 * When the nightly run should actually fetch each page.
 *
 * Two things must hold at once: tabstop must not arrive at one origin with
 * every page it tracks for that origin at the same instant, and must not land
 * its whole night's work in one spike. Spreading the run over a window solves
 * both; the only question is how the offset is chosen.
 *
 * DETERMINISTICALLY, from the domain. Random jitter spreads load equally well
 * but moves every page's audit time nightly, so a trend line would compare
 * 03:00 Monday against 07:00 Tuesday. For a product whose output is "did this
 * get worse", a measurement whose conditions wander is worth less.
 */

/** Six hours. Long enough to flatten the spike, short enough to be "nightly". */
export const JITTER_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Pages on one domain share a base offset, so without this they would all
 * arrive together. A minute apart covers a monitored page load and keeps an
 * account's pages within one browsing session of each other. It also sets how
 * many slots a domain can occupy: 360 in a six-hour window.
 */
export const SAME_DOMAIN_STAGGER_MS = 60_000;

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

/**
 * FNV-1a, 32-bit, rather than the sha256 #13 sketched.
 *
 * Nothing here needs a cryptographic property, and `domain/` may import NOTHING
 * - not even node: builtins, a rule `architecture.spec.ts` enforces - so
 * `node:crypto` would mean breaking that boundary or adding a port for a hash
 * whose only requirement is that it spreads.
 *
 * `Math.imul` because the multiply overflows 32 bits every round and plain `*`
 * drifts into float territory, which is how a hash stops being uniform. Read as
 * UTF-16 code units, exact for these hostnames since anything non-ASCII arrives
 * already punycoded.
 */
const fnv1a = (value: string): number => {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  // Unsigned: `Math.imul` is signed, and a negative offset is a delay in the
  // past, which BullMQ runs immediately - collapsing the spread entirely.
  return hash >>> 0;
};

/**
 * How long after the run starts this page should be fetched.
 *
 * The domain sets the base offset and the page picks a stagger slot within it,
 * so pages sharing a host are separated while the host lands where it always
 * lands.
 *
 * Both halves derive from IDENTITY, never from position in the run: position
 * shifts when a sibling is added, paused or still mid-audit, and a retry sees
 * only the failed pages, restarting the numbering at zero. The cost is that two
 * pages on one domain can now share a slot - a few percent of the time with 360
 * slots.
 *
 * That is acceptable because this never enforced per-origin politeness.
 * `AUDIT_CONCURRENCY` goes to 16, so colliding jobs really can reach one host
 * together; serialising them is #41's job at the worker, which it has to be,
 * since a delay can only separate jobs that start on time. This key is the
 * hostname, so it does not even group `a.example.com` with `b.example.com`.
 */
export const reauditDelayMs = (
  domain: string,
  pageId: string,
  windowMs: number = JITTER_WINDOW_MS,
  staggerMs: number = SAME_DOMAIN_STAGGER_MS,
): number => {
  // At least one, so a window shorter than a single stagger step still yields a
  // usable slot instead of dividing by zero.
  const slots = Math.max(1, Math.floor(windowMs / staggerMs));
  const slot = fnv1a(pageId) % slots;
  return (fnv1a(domain) + slot * staggerMs) % windowMs;
};

export const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

export const utcDayStart = (at: Date): Date => new Date(`${utcDay(at)}T00:00:00.000Z`);
