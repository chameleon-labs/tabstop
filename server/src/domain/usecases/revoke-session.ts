export interface RevokeSession {
  /** Idempotent: revoking an unknown or already-revoked session is not an error. */
  revoke: (sessionId: string) => Promise<void>
}
