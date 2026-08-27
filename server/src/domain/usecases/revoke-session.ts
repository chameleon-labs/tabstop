export interface RevokeSession {
  revoke: (sessionId: string) => Promise<void>;
}
