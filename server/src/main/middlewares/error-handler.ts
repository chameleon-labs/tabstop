import type { NextFunction, Request, Response } from 'express'

/**
 * Body-parser rejects a request before any route runs, so `adaptRoute`'s
 * try/catch - which is what makes every OTHER failure a JSON `{ error }` -
 * never sees these. They arrive here instead, as errors carrying a `type` and
 * a `status`.
 *
 * The message is ours rather than the parser's, for the same reason the audit
 * classifier writes its own: a library's wording is not an API contract, and
 * "request entity too large" tells a caller less than the limit does.
 */
const BODY_PARSER_MESSAGES: Readonly<Record<string, string>> = {
  'entity.parse.failed': 'That request body is not valid JSON',
  'entity.too.large': 'That request body is too large',
  'encoding.unsupported': 'That content encoding is not supported',
  'request.aborted': 'The request was aborted before it finished',
  'request.size.invalid': 'That request body did not match its content-length'
}

const statusOf = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null) return null
  const status = 'status' in error ? error.status : 'statusCode' in error ? error.statusCode : null
  // 4xx only. A library reporting 500 is reporting something unexpected, and
  // that must fall through to the generic answer below rather than be trusted.
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null
}

const typeOf = (error: unknown): string | null =>
  typeof error === 'object' && error !== null && 'type' in error && typeof error.type === 'string'
    ? error.type
    : null

/**
 * The last thing in the stack, and the only reason this API cannot answer with
 * an HTML page.
 *
 * Express's default handler serialises the error into `<pre>` - including the
 * stack whenever NODE_ENV is not exactly "production", which nothing in this
 * repo sets. That published absolute paths (naming the deploy user and
 * directory layout) and the exact version of every package in the frame list,
 * which is a shopping list for known CVEs. It also broke the one thing every
 * client may assume: that a failure is still JSON.
 *
 * Nothing derived from the error reaches the response unless this file chose
 * the wording. An unrecognised error is a 500 with no detail at all, and the
 * detail goes to the log instead, where it is useful and not public.
 */
export const errorHandler = (
  error: unknown, _req: Request, res: Response, next: NextFunction
): void => {
  // Express's own contract: once headers are out, the response belongs to
  // whoever started it and the only correct move is to destroy the socket.
  if (res.headersSent) {
    next(error)
    return
  }

  const type = typeOf(error)
  const status = statusOf(error)
  const known = type !== null ? BODY_PARSER_MESSAGES[type] : undefined

  if (known !== undefined && status !== null) {
    res.status(status).json({ error: known })
    return
  }

  console.error('Unhandled error:', error)
  res.status(500).json({ error: 'Internal server error' })
}

/**
 * Matches after every route, so it only ever runs for a path or method nothing
 * claimed. Without it those fell through to Express's default 404, which is
 * also HTML - so a client parsing the error shape had to special-case exactly
 * the response it was least likely to have tested.
 */
export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Not found' })
}
