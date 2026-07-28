/**
 * A cookie the response should set or clear. The presentation layer describes
 * the intent; the express adapter applies it and owns the security attributes
 * (httpOnly, sameSite, secure, path), so a controller cannot weaken them and
 * there is exactly one place to audit.
 */
export type CookieDirective =
  | { action: 'set', name: string, value: string, expiresAt: Date }
  | { action: 'clear', name: string }

export type HttpResponse<T = unknown> = {
  statusCode: number
  body: T
  cookies?: CookieDirective[]
  /**
   * Applied after any middleware default, so a controller can opt out of the
   * global no-store. Security attributes stay in the adapter, where a
   * controller cannot weaken them; this is for response metadata a controller
   * legitimately owns, such as whether its result is cacheable.
   */
  headers?: Record<string, string>
}
