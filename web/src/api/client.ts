import type {CodedConflictBody, PageConflictBody, RateLimitedBody} from '@tabstop/contract';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
    if (!isPositiveInteger(limit)) {
      return null;
    }
    return {code: 'page_limit_reached', error: conflict.error, limit};
  }

  return null;
};
