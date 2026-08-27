import {z} from 'zod';
import {ZodValidationAdapter} from '../../../infra/validation/zod-validation-adapter.js';
import type {AddPageBody} from '../../../presentation/controllers/page/add-page-controller.js';
import type {LoadPageHistoryQuery} from '../../../presentation/controllers/page/load-page-history-controller.js';
import type {UpdatePageBody} from '../../../presentation/controllers/page/update-page-controller.js';
import type {Validation} from '../../../presentation/protocols/validation.js';

const MAX_URL_LENGTH = 2048;

const addPageSchema = z.object({
  url: z.string().trim().min(1).max(MAX_URL_LENGTH),
});

const updatePageSchema = z.object({
  monitoringEnabled: z.boolean(),
});

const DEFAULT_HISTORY_DAYS = 90;
const MAX_HISTORY_DAYS = 365;

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
