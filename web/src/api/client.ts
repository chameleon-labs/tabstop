import type {CodedConflictBody, PageConflictBody, RateLimitedBody} from '@tabstop/contract';

/**
 * Empty by default, which makes every request same-origin and sends it through
 * the dev proxy. A deployed build sets `VITE_API_URL`: `app.tabstop.dev`
 * calling `api.tabstop.dev` is same-SITE, which is what lets `SameSite=Lax`
 * work, but it is still cross-ORIGIN.
 */
const BASE_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * A response the server produced. Distinct from a `fetch` rejection, which
 * means the request never got an answer - the two want different retry
 * behaviour, and only this one carries a body worth reading.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Parsed if the response was JSON, `null` otherwise. Never trusted blindly. */
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Error bodies are validated at runtime; success bodies are not.
 *
 * A success body is described by `@tabstop/contract` and the server's typecheck
 * fails if its mapper stops matching, so re-validating here would duplicate an
 * existing guarantee in a bundle the user downloads. An error body has no such
 * guarantee - a proxy 502 or a limiter that fell over produce responses the
 * server never wrote - and callers BRANCH on these, so a wrong shape is a
 * behaviour bug rather than a display one.
 */
const errorMessage = (body: unknown, response: Response): string => {
  if (isRecord(body) && typeof body['error'] === 'string' && body['error'] !== '') {
    return body['error'];
  }
  return response.statusText === '' ? `Request failed (${response.status})` : response.statusText;
};

const readBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204) {
    return null;
  }
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    return null;
  }
  // A malformed body must not become a different, more confusing error than
  // the status the caller already has to handle.
  return await response.json().catch(() => null);
};

const headersFor = (init: RequestInit): Headers => {
  const headers = new Headers({accept: 'application/json'});
  if (init.body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  new Headers(init.headers).forEach((value, name) => {
    headers.set(name, value);
  });

  return headers;
};

export const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: headersFor(init),
  });

  const body = await readBody(response);
  if (!response.ok) {
    throw new ApiError(response.status, errorMessage(body, response), body);
  }

  return body as T;
};

export const post = async <T>(path: string, payload: unknown): Promise<T> =>
  await request<T>(path, {method: 'POST', body: JSON.stringify(payload)});

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const isTimestamp = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

export const rateLimitOf = (error: unknown): RateLimitedBody | null => {
  if (!isApiError(error) || error.status !== 429) {
    return null;
  }
  const {body} = error;
  if (!isRecord(body)) {
    return null;
  }
  if (!isPositiveInteger(body['retryAfter']) || !isTimestamp(body['resetAt'])) {
    return null;
  }
  return {error: error.message, retryAfter: body['retryAfter'], resetAt: body['resetAt']};
};

/**
 * The machine-readable code on a 409 the client has to branch on - "you are at
 * your limit" wants an upgrade prompt, "you already track this" wants a link.
 * Null for a plain 409, which is only ever displayed.
 */
export const conflictOf = (error: unknown): CodedConflictBody | null => {
  if (!isApiError(error) || error.status !== 409) {
    return null;
  }
  const {body} = error;
  if (!isRecord(body) || typeof body['code'] !== 'string') {
    return null;
  }
  return {code: body['code'], error: error.message};
};

/**
 * A `POST /api/pages` conflict, narrowed to the variant it actually is.
 *
 * `conflictOf` answers the generic question a shared handler wants. It cannot
 * answer this one: `limit` exists on only one variant, and a shape wide enough
 * for both drops it, leaving a screen unable to say "10 of 10" without
 * hardcoding the cap the server owns.
 *
 * Null for an unknown code, deliberately: a server that adds a third should
 * degrade to displaying the sentence it sent.
 */
export const pageConflictOf = (error: unknown): PageConflictBody | null => {
  const conflict = conflictOf(error);
  if (conflict === null || !isApiError(error) || !isRecord(error.body)) {
    return null;
  }

  if (conflict.code === 'page_already_tracked') {
    return {code: 'page_already_tracked', error: conflict.error};
  }

  if (conflict.code === 'page_limit_reached') {
    const {limit} = error.body;
    // Guessing a limit would put a wrong number in front of a person.
    if (!isPositiveInteger(limit)) {
      return null;
    }
    return {code: 'page_limit_reached', error: conflict.error, limit};
  }

  return null;
};
