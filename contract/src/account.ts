/**
 * `GET /api/me`, 200 - or 401 with an `ApiErrorBody` when there is no session.
 *
 * That pair IS the auth state. The session is an httpOnly cookie, so the
 * frontend can never read it; there is no "is there a token in storage" check
 * to make, and initial load is planned around one call to this endpoint rather
 * than around inspecting anything locally.
 */
export type AccountResponse = {
  id: string
  email: string
  /**
   * The score drop, in points, that is worth an email. Chosen by the account,
   * so the frontend renders it rather than assuming a default.
   */
  alertThreshold: number
}
