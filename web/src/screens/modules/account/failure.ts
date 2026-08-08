import {isApiError} from '@/api/client';

const UNREACHABLE = 'Could not reach tabstop. Check your connection and try again';

export const authFailureMessage = (error: unknown): string => (isApiError(error) ? error.message : UNREACHABLE);
