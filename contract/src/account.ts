/**
 * `GET /api/me`, 200 - or 401 with an `ApiErrorBody` when there is no session.
 *
 * That pair IS the auth state. The session is an httpOnly cookie the frontend
 * can never read, so there is no local token to inspect and initial load is
 * planned around one call to this endpoint.
 */
export type AccountResponse = {
  id: string;
  email: string;
  /**
   * The score drop, in points, that is worth an email. Chosen by the account,
   * so the frontend renders it rather than assuming a default.
   */
  alertThreshold: number;
};
