/**
 * The UTC calendar day, which is the unit several unrelated rules are counted
 * in: the nightly run's dedupe, the alert-per-page-per-day index, and the
 * account's on-demand audit allowance.
 *
 * Here rather than in whichever module needed it first, because a second
 * definition of "which day is it" is free to disagree with the first - and the
 * one that drifts is the one nobody runs. UTC rather than local for the reason
 * `007` records: a local reading rolls over at an instant that is already
 * tomorrow somewhere else, stamping a date the constraints are not deduping on.
 */
export const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

export const utcDayStart = (at: Date): Date => new Date(`${utcDay(at)}T00:00:00.000Z`);
