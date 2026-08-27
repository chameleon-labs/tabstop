import type {AuditResultResponse, RateLimitedBody} from '@tabstop/contract';
import {isApiError, rateLimitOf} from '@/api/client';

export type FailureAction = 'retry' | 'check-url' | 'signup' | 'none';

export type FailureSource = 'request' | 'poll' | 'audit';

export type DescribedFailure = {
  message: string;
  action: FailureAction;
  source: FailureSource;
  rateLimit?: RateLimitedBody;
};

const GENERIC = 'Something went wrong';

export const UNREACHABLE_REQUEST = 'Could not reach tabstop. Check your connection and try again';
const UNREACHABLE_POLL = 'Lost contact with tabstop. The audit may still be running';

export const describeRequestFailure = (error: unknown): DescribedFailure => {
  const limit = rateLimitOf(error);
  if (limit !== null) {
    return {message: limit.error, action: 'signup', source: 'request', rateLimit: limit};
  }

  if (!isApiError(error)) {
    return {message: UNREACHABLE_REQUEST, action: 'retry', source: 'request'};
  }

  if (error.status === 400) {
    return {message: error.message, action: 'check-url', source: 'request'};
  }

  if (error.status >= 500) {
    return {message: error.message, action: 'retry', source: 'request'};
  }

  return {message: error.message, action: 'none', source: 'request'};
};

export const describePollFailure = (error: unknown): DescribedFailure => {
  if (!isApiError(error)) {
    return {message: UNREACHABLE_POLL, action: 'retry', source: 'poll'};
  }

  if (error.status === 404) {
    return {message: error.message, action: 'none', source: 'poll'};
  }

  return {message: error.message, action: 'retry', source: 'poll'};
};

export const describeAuditFailure = (audit: AuditResultResponse): DescribedFailure => ({
  message: audit.error ?? GENERIC,
  action: 'retry',
  source: 'audit',
});

export type FailureSources = {
  requestError: unknown;
  pollError: unknown;
  audit: AuditResultResponse | undefined;
};

export const describeFailure = ({requestError, pollError, audit}: FailureSources): DescribedFailure | null => {
  if (requestError !== null && requestError !== undefined) {
    return describeRequestFailure(requestError);
  }
  if (pollError !== null && pollError !== undefined) {
    return describePollFailure(pollError);
  }
  if (audit?.status === 'failed') {
    return describeAuditFailure(audit);
  }
  return null;
};

export const isRateLimited = (failure: DescribedFailure): failure is DescribedFailure & {rateLimit: RateLimitedBody} =>
  failure.action === 'signup' && failure.rateLimit !== undefined;
