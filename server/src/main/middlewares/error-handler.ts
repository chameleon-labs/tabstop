import type {NextFunction, Request, Response} from 'express';

const BODY_PARSER_MESSAGES: Readonly<Record<string, string>> = {
  'entity.parse.failed': 'That request body is not valid JSON',
  'entity.too.large': 'That request body is too large',
  'encoding.unsupported': 'That content encoding is not supported',
  'request.aborted': 'The request was aborted before it finished',
  'request.size.invalid': 'That request body did not match its content-length',
};

const asClientError = (status: unknown): number | null =>
  typeof status === 'number' && status >= 400 && status < 500 ? status : null;

const statusOf = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  if ('status' in error) {
    return asClientError(error.status);
  }
  if ('statusCode' in error) {
    return asClientError(error.statusCode);
  }
  return null;
};

const typeOf = (error: unknown): string | null =>
  typeof error === 'object' && error !== null && 'type' in error && typeof error.type === 'string' ? error.type : null;

export const errorHandler = (error: unknown, _req: Request, res: Response, next: NextFunction): void => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const type = typeOf(error);
  const status = statusOf(error);
  const known = type !== null ? BODY_PARSER_MESSAGES[type] : undefined;

  if (known !== undefined && status !== null) {
    res.status(status).json({error: known});
    return;
  }

  console.error('Unhandled error:', error);
  res.status(500).json({error: 'Internal server error'});
};

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({error: 'Not found'});
};
