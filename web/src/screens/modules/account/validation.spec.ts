import {describe, expect, it} from 'vitest';
import {validateLogin, validateSignup} from './validation';

describe('validateLogin', () => {
  it('requires an email address', () => {
    expect(validateLogin({email: '', password: 'x'})).toEqual({email: 'Enter your email address'});
  });

  it('rejects malformed email addresses', () => {
    expect(validateLogin({email: 'not-an-email', password: 'x'})).toEqual({email: 'Enter a valid email address'});
  });

  it('requires a password without applying signup password rules', () => {
    expect(validateLogin({email: 'person@example.com', password: ''})).toEqual({password: 'Enter your password'});
  });

  it('accepts valid login credentials', () => {
    expect(validateLogin({email: 'person@example.com', password: 'x'})).toEqual({});
  });

  it('accepts surrounding email whitespace that the server trims', () => {
    expect(validateLogin({email: ' person@example.com ', password: 'x'})).toEqual({});
  });
});

describe('validateSignup', () => {
  it('requires an email address', () => {
    expect(validateSignup({email: '', password: 'x'.repeat(12)})).toEqual({email: 'Enter your email address'});
  });

  it('rejects malformed email addresses', () => {
    expect(validateSignup({email: 'not-an-email', password: 'x'.repeat(12)})).toEqual({
      email: 'Enter a valid email address',
    });
  });

  it('rejects passwords shorter than twelve characters', () => {
    expect(validateSignup({email: 'person@example.com', password: 'x'.repeat(11)})).toEqual({
      password: 'Use at least 12 characters',
    });
  });

  it('accepts a twelve-character password', () => {
    expect(validateSignup({email: 'person@example.com', password: 'x'.repeat(12)})).toEqual({});
  });

  it('accepts surrounding email whitespace that the server trims', () => {
    expect(validateSignup({email: ' person@example.com ', password: 'x'.repeat(12)})).toEqual({});
  });

  it('accepts a two-hundred-character password', () => {
    expect(validateSignup({email: 'person@example.com', password: 'x'.repeat(200)})).toEqual({});
  });

  it('rejects passwords longer than two hundred characters', () => {
    expect(validateSignup({email: 'person@example.com', password: 'x'.repeat(201)})).toEqual({
      password: 'Use no more than 200 characters',
    });
  });
});
