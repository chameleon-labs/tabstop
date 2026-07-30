import { ServerError } from '../../errors/server-error.js'
import type { CookieDirective, HttpResponse } from '../../protocols/http.js'

export const ok = <T>(body: T): HttpResponse<T> => ({
  statusCode: 200,
  body
})

export const created = <T>(body: T, cookies?: CookieDirective[]): HttpResponse<T> => (
  cookies === undefined
    ? { statusCode: 201, body }
    : { statusCode: 201, body, cookies }
)

export const accepted = <T>(body: T): HttpResponse<T> => ({
  statusCode: 202,
  body
})

export const notFound = (error: Error): HttpResponse<{ error: string }> => ({
  statusCode: 404,
  body: { error: error.message }
})

export const okCacheable = <T>(body: T, cacheControl: string): HttpResponse<T> => ({
  statusCode: 200,
  body,
  headers: { 'cache-control': cacheControl }
})

export const okWithCookies = <T>(body: T, cookies: CookieDirective[]): HttpResponse<T> => ({
  statusCode: 200,
  body,
  cookies
})

export const noContent = (cookies?: CookieDirective[]): HttpResponse<null> => (
  cookies === undefined
    ? { statusCode: 204, body: null }
    : { statusCode: 204, body: null, cookies }
)

export const badRequest = (error: Error): HttpResponse<{ error: string }> => ({
  statusCode: 400,
  body: { error: error.message }
})

export const unauthorized = (error: Error): HttpResponse<{ error: string }> => ({
  statusCode: 401,
  body: { error: error.message }
})

export const conflict = (error: Error): HttpResponse<{ error: string }> => ({
  statusCode: 409,
  body: { error: error.message }
})

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
  code: string, error: Error, details: Record<string, number | string> = {}
): HttpResponse<{ code: string, error: string }> => ({
  statusCode: 409,
  body: { code, error: error.message, ...details }
})

export const serverError = (error: Error): HttpResponse<{ error: string }> => ({
  statusCode: 500,
  body: { error: new ServerError(error).message }
})

export const serviceUnavailable = <T>(body: T): HttpResponse<T> => ({
  statusCode: 503,
  body
})
