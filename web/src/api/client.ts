import type { CodedConflictBody, RateLimitedBody } from '@tabstop/contract'

/**
 * Empty by default, which makes every request same-origin and sends it through
 * the dev proxy. A deployed build sets `VITE_API_URL` to the API origin -
 * `app.tabstop.dev` calling `api.tabstop.dev` is same-SITE, which is what lets
 * `SameSite=Lax` work, but it is still cross-ORIGIN.
 */
const BASE_URL = import.meta.env.VITE_API_URL ?? ''

/**
 * A response the server produced. Distinct from a `fetch` rejection, which
 * means the request never got an answer at all - the two want different retry
 * behaviour, and only this one carries a body worth reading.
 */
export class ApiError extends Error {
  constructor (
    readonly status: number,
    message: string,
    /** Parsed if the response was JSON, `null` otherwise. Never trusted blindly. */
    readonly body: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Error bodies are validated at runtime; success bodies are not. That is a
 * deliberate split rather than an oversight.
 *
 * A success body is described by `@tabstop/contract`, and the server is checked
 * against that same contract at compile time - `presentation/helpers/
 * contract-proof.ts` fails the server's typecheck if its mapper stops matching.
 * Re-validating it here would duplicate a guarantee that already exists, in a
 * bundle the user downloads.
 *
 * An error body has no such guarantee: a 502 from a proxy, an nginx error page,
 * or a rate limiter that fell over produce responses the server never wrote. We
 * BRANCH on these - a 429's `resetAt` becomes a countdown, a 409's `code`
 * chooses a different screen - so being wrong about the shape is a behaviour
 * bug, not a display bug.
 */
const errorMessage = (body: unknown, response: Response): string => {
  if (isRecord(body) && typeof body['error'] === 'string' && body['error'] !== '') {
    return body['error']
  }
  return response.statusText === '' ? `Request failed (${response.status})` : response.statusText
}

const readBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204) return null
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) return null
  // A truncated or malformed body is still a response the caller has to handle;
  // it must not become a different, more confusing error than the status.
  return await response.json().catch(() => null)
}

/**
 * The only place the app calls `fetch`.
 *
 * `credentials: 'include'` is on every request and is not optional. The session
 * is an httpOnly cookie (#10), `fetch` does not send cookies cross-origin
 * without this, and omitting it returns 401 from a perfectly valid session
 * while looking exactly like a backend bug.
 *
 * `T` is the caller's claim about the success body. See `errorMessage` above
 * for why that claim is not re-checked here.
 */
export const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: init.body === undefined
      ? { accept: 'application/json', ...init.headers }
      : { accept: 'application/json', 'content-type': 'application/json', ...init.headers }
  })

  const body = await readBody(response)
  if (!response.ok) throw new ApiError(response.status, errorMessage(body, response), body)

  return body as T
}

export const post = async <T>(path: string, payload: unknown): Promise<T> =>
  await request<T>(path, { method: 'POST', body: JSON.stringify(payload) })

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError

/**
 * The 429 details, or null if this was not a rate limit.
 *
 * Every field is checked because the branch depends on them: a `resetAt` that
 * is actually undefined renders `Invalid Date` in a countdown, and a
 * `retryAfter` that is a string silently disables any arithmetic on it.
 */
export const rateLimitOf = (error: unknown): RateLimitedBody | null => {
  if (!isApiError(error) || error.status !== 429) return null
  const body = error.body
  if (!isRecord(body)) return null
  if (typeof body['retryAfter'] !== 'number' || typeof body['resetAt'] !== 'string') return null
  return { error: error.message, retryAfter: body['retryAfter'], resetAt: body['resetAt'] }
}

/**
 * The machine-readable code on a 409 the client has to branch on - "you are at
 * your limit" wants an upgrade prompt, "you already track this" wants a link.
 * Null for a plain 409, which is only ever displayed.
 */
export const conflictOf = (error: unknown): CodedConflictBody | null => {
  if (!isApiError(error) || error.status !== 409) return null
  const body = error.body
  if (!isRecord(body) || typeof body['code'] !== 'string') return null
  return { code: body['code'], error: error.message }
}
