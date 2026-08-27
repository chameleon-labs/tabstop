import type {ApiErrorBody, CodedConflictBody} from '@tabstop/contract';
import {ServerError} from '../../errors/server-error.js';
import type {CookieDirective, HttpResponse} from '../../protocols/http.js';

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
