import type {HttpResponse} from './http.js';

export type MiddlewareRequest = {
  cookies: Record<string, string>;
};

export interface Middleware {
  handle: (request: MiddlewareRequest) => Promise<HttpResponse>;
}
