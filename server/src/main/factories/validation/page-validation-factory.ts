import {z} from 'zod';
import {ZodValidationAdapter} from '../../../infra/validation/zod-validation-adapter.js';
import type {AddPageBody} from '../../../presentation/controllers/page/add-page-controller.js';
import type {LoadPageHistoryQuery} from '../../../presentation/controllers/page/load-page-history-controller.js';
import type {UpdatePageBody} from '../../../presentation/controllers/page/update-page-controller.js';
import type {Validation} from '../../../presentation/protocols/validation.js';

/**
 * Long enough for any real page, short enough that a body cannot become a
 * megabyte stored on every row and re-fetched nightly. Browsers and proxies
 * stop being reliable well below this.
 */
const MAX_URL_LENGTH = 2048;

/**
 * Shape only. Whether the url is SAFE - scheme, port, credentials, and where
 * it resolves - is the usecase's job, because those rules live in domain/ and
 * infra/ where they can be exercised without a schema in the way.
 */
const addPageSchema = z.object({
  url: z.string().trim().min(1).max(MAX_URL_LENGTH),
});

/**
 * A strict boolean, not a coerced one. `z.coerce.boolean()` maps the string
 * "false" to true, so a client sending `{"monitoringEnabled": "false"}` would
 * silently resume monitoring it asked to pause.
 */
const updatePageSchema = z.object({
  monitoringEnabled: z.boolean(),
});

/** Roughly a quarter, which is the window the trend chart (#21) opens on. */
const DEFAULT_HISTORY_DAYS = 90;
/**
 * A year. Not a guess about what anyone wants - it is the point past which the
 * request stops being a chart and becomes a free table scan for whoever asks.
 */
const MAX_HISTORY_DAYS = 365;

/**
 * `days` is CLAMPED at the ceiling, but a non-integer is still a 400.
 *
 * The two halves are different kinds of wrong. `days=100000` is a coherent
 * request for more than we will serve, and the response echoes `days` back, so
 * answering with a year is honest rather than silently truncated - and it
 * closes the scan. `days=lastweek` is not a request we understood at all, and
 * clamping it would mean picking a number on the caller's behalf and pretending
 * they asked for it.
 *
 * `z.coerce` because a query string is always text; it maps "abc" to NaN, which
 * the integer check then rejects.
 */
const historyQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1)
    .transform((value) => Math.min(value, MAX_HISTORY_DAYS))
    .default(DEFAULT_HISTORY_DAYS),
});

export const makeAddPageValidation = (): Validation<AddPageBody> =>
  new ZodValidationAdapter<AddPageBody>(addPageSchema);

export const makeUpdatePageValidation = (): Validation<UpdatePageBody> =>
  new ZodValidationAdapter<UpdatePageBody>(updatePageSchema);

export const makeLoadPageHistoryValidation = (): Validation<LoadPageHistoryQuery> =>
  new ZodValidationAdapter<LoadPageHistoryQuery>(historyQuerySchema);
