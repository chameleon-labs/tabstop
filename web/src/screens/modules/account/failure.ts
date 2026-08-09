import {isApiError} from '@/api/client';

const UNREACHABLE = 'Could not reach tabstop. Check your connection and try again';

export class AuthConfirmationError extends Error {
  override name = 'AuthConfirmationError';
}

export const authFailureMessage = (error: unknown): string =>
  isApiError(error) || error instanceof AuthConfirmationError ? error.message : UNREACHABLE;
