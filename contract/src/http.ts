export type ApiErrorBody = {
  error: string;
};

export type RateLimitedBody = ApiErrorBody & {
  retryAfter: number;
  resetAt: string;
};

export type CodedConflictBody = ApiErrorBody & {
  code: string;
};
