import type {ApiErrorBody, CodedConflictBody} from '@tabstop/contract';
import {ServerError} from '../../errors/server-error.js';
import type {CookieDirective, HttpResponse} from '../../protocols/http.js';

/**
 * Every error response is annotated with the type `@tabstop/contract` publishes,
 * rather than with an inline `{ error: string }` that merely looks like it.
 *
 * The client BRANCHES on these - it reads `error` on every failure, `code` on a
 * 409, `retryAfter`/`resetAt` on a 429 - so the shapes are as load-bearing as
 * any success payload. Left unannotated, renaming `error` here would typecheck
 * on both sides and only surface as a blank message in a browser.
 */

export const ok = <T>(body: T): HttpResponse<T> => ({
  statusCode: 200,
  body,
});

export const okHtml = (body: string): HttpResponse<string> => ({
  statusCode: 200,
  body,
  bodyType: 'html',
});

export const created = <T>(body: T, cookies?: CookieDirective[]): HttpResponse<T> =>
  cookies === undefined ? {statusCode: 201, body} : {statusCode: 201, body, cookies};

export const accepted = <T>(body: T): HttpResponse<T> => ({
  statusCode: 202,
  body,
});

export const notFound = (error: Error): HttpResponse<ApiErrorBody> => ({
  statusCode: 404,
  body: {error: error.message},
});

/**
 * `vary` matters as soon as a cacheable response is owner-scoped: the URL
 * alone stops identifying it, so two accounts sharing a browser would
 * otherwise share one cache entry for `/api/pages/1/history`. Optional,
 * because a fully public response - the share page - genuinely varies on
 * nothing.
 */
export const okCacheable = <T>(body: T, cacheControl: string, vary?: string): HttpResponse<T> => ({
  statusCode: 200,
  body,
  headers: vary === undefined ? {'cache-control': cacheControl} : {'cache-control': cacheControl, vary},
});

export const okWithCookies = <T>(body: T, cookies: CookieDirective[]): HttpResponse<T> => ({
  statusCode: 200,
  body,
  cookies,
});

export const noContent = (cookies?: CookieDirective[]): HttpResponse<null> =>
  cookies === undefined ? {statusCode: 204, body: null} : {statusCode: 204, body: null, cookies};

export const badRequest = (error: Error): HttpResponse<ApiErrorBody> => ({
  statusCode: 400,
  body: {error: error.message},
});

export const unauthorized = (error: Error): HttpResponse<ApiErrorBody> => ({
  statusCode: 401,
  body: {error: error.message},
});

export const conflict = (error: Error): HttpResponse<ApiErrorBody> => ({
  statusCode: 409,
  body: {error: error.message},
});

/**
 * A conflict the client has to BRANCH on rather than only display - "you are
 * at your limit" wants an upgrade prompt, "you already track this" wants a
 * link to the page - so it carries a stable machine-readable `code` and
 * whatever the branch needs to render.
 *
 * `error` keeps meaning what it means on every other response: the sentence to
 * show a person. Overloading it with the code instead, as #11's sketch did,
 * would make one endpoint's `error` field a different kind of thing from all
 * the others and break any generic client handler.
 */
export const codedConflict = (
  code: string,
  error: Error,
  details: Record<string, number | string> = {},
): HttpResponse<CodedConflictBody> => ({
  statusCode: 409,
  body: {code, error: error.message, ...details},
});

export const serverError = (error: Error): HttpResponse<ApiErrorBody> => ({
  statusCode: 500,
  body: {error: new ServerError(error).message},
});

export const serviceUnavailable = <T>(body: T): HttpResponse<T> => ({
  statusCode: 503,
  body,
});
