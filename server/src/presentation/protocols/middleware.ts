import type {HttpResponse} from './http.js';

export type MiddlewareRequest = {
  cookies: Record<string, string>;
};

/**
 * Mirrors Controller: returns an HttpResponse and never touches Express, so it
 * is unit-testable and the layering stays honest. main/ adapts it.
 */
export interface Middleware {
  handle: (request: MiddlewareRequest) => Promise<HttpResponse>;
}
