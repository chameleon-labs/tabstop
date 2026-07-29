import { z } from 'zod'
import { ZodValidationAdapter } from '../../../infra/validation/zod-validation-adapter.js'
import type { AddPageBody } from '../../../presentation/controllers/page/add-page-controller.js'
import type {
  UpdatePageBody
} from '../../../presentation/controllers/page/update-page-controller.js'
import type { Validation } from '../../../presentation/protocols/validation.js'

/**
 * Long enough for any real page, short enough that a body cannot become a
 * megabyte stored on every row and re-fetched nightly. Browsers and proxies
 * stop being reliable well below this.
 */
const MAX_URL_LENGTH = 2048

/**
 * Shape only. Whether the url is SAFE - scheme, port, credentials, and where
 * it resolves - is the usecase's job, because those rules live in domain/ and
 * infra/ where they can be exercised without a schema in the way.
 */
const addPageSchema = z.object({
  url: z.string().trim().min(1).max(MAX_URL_LENGTH)
})

/**
 * A strict boolean, not a coerced one. `z.coerce.boolean()` maps the string
 * "false" to true, so a client sending `{"monitoringEnabled": "false"}` would
 * silently resume monitoring it asked to pause.
 */
const updatePageSchema = z.object({
  monitoringEnabled: z.boolean()
})

export const makeAddPageValidation = (): Validation<AddPageBody> =>
  new ZodValidationAdapter<AddPageBody>(addPageSchema)

export const makeUpdatePageValidation = (): Validation<UpdatePageBody> =>
  new ZodValidationAdapter<UpdatePageBody>(updatePageSchema)
