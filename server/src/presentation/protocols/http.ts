export type HttpResponse<T = unknown> = {
  statusCode: number
  body: T
}
