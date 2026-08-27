export type CookieDirective =
  | {action: 'set'; name: string; value: string; expiresAt: Date}
  | {action: 'clear'; name: string};

export type HttpResponse<T = unknown> = {
  statusCode: number;
  body: T;
  bodyType?: 'json' | 'html';
  cookies?: CookieDirective[];
  headers?: Record<string, string>;
};
