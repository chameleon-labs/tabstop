/**
 * How many pages one account may monitor.
 *
 * A constant rather than an environment variable, for the same reason the rate
 * limits are: it is a product decision, not an operator dial, and this repo
 * deploys from git so changing it is a commit either way. #35 replaces it with
 * a per-plan quota, at which point it stops being one number for everybody -
 * which is why it is passed into the usecase rather than read inside it.
 */
export const PAGE_LIMIT = 10;
