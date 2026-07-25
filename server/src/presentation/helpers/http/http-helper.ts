import { ServerError } from '../../errors/server-error.js'
import type { HttpResponse } from '../../protocols/http.js'

export const ok = <T>(body: T): HttpResponse<T> => ({
  statusCode: 200,
  body
})

export const badRequest = (error: Error): HttpResponse<{ error: string }> => ({
  statusCode: 400,
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
