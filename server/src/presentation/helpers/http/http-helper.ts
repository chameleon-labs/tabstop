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

export const serverError = (error: Error): HttpResponse<{ error: string }> => ({
  statusCode: 500,
  body: { error: new ServerError(error).message }
})

export const serviceUnavailable = <T>(body: T): HttpResponse<T> => ({
  statusCode: 503,
  body
})
