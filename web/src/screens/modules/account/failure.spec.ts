import {describe, expect, it} from 'vitest';
import {ApiError} from '@/api/client';
import {authFailureMessage} from './failure';

describe('authFailureMessage', () => {
  it('keeps the API error sentence', () => {
    expect(authFailureMessage(new ApiError(401, 'Invalid email or password', {}))).toBe('Invalid email or password');
  });

  it('uses the stable connection fallback for non-API failures', () => {
    expect(authFailureMessage(new TypeError('Failed to fetch'))).toBe(
      'Could not reach tabstop. Check your connection and try again',
    );
  });
});
