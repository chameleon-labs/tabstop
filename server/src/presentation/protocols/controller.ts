import type { HttpResponse } from './http.js'

export interface Controller<Request = unknown> {
  handle: (request: Request) => Promise<HttpResponse>
}
