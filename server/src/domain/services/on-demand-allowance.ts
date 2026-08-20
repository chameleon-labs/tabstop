import {utcDayStart} from './utc-day.js';

/**
 * How many audits an account may ask for itself in one UTC day (#115).
 *
 * One, and a constant rather than a rate-limiter bucket, because the two
 * express different things. A token bucket refills continuously and bounds a
 * REQUEST RATE, which is what the per-IP limiter in front of every route is
 * for; this is an ENTITLEMENT, counted over rows that are already durable, and
 * it is the number a paid plan raises. A bucket also cannot answer "when do I
 * get another one", which is the sentence a refused reader needs.
 *
 * Per account rather than per page: an allowance that scaled with how many
 * pages an account holds would make the cost of the free tier depend on
 * something the account chooses, and a per-page cooldown adds nothing while
 * this is one - a single daily audit cannot reach the same page twice.
 */
export const ON_DEMAND_AUDITS_PER_DAY = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a spent allowance refills: the next UTC midnight, never a rolling window. */
export const nextAllowanceAt = (now: Date): Date => new Date(utcDayStart(now).getTime() + DAY_MS);
