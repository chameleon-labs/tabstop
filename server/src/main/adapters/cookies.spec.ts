import {describe, expect, it} from 'vitest';
import {parseCookies} from './cookies.js';

describe('parseCookies', () => {
  it('parses a header into name/value pairs', () => {
    expect(parseCookies('sid=abc; other=1')).toEqual({sid: 'abc', other: '1'});
  });

  it('survives absent, empty and malformed headers', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
    expect(parseCookies('novalue')).toEqual({});
    expect(parseCookies('=orphaned')).toEqual({});
  });

  it('trims surrounding whitespace and keeps "=" inside a value', () => {
    expect(parseCookies('  sid = spaced  ')).toEqual({sid: 'spaced'});
    expect(parseCookies('sid=a=b')).toEqual({sid: 'a=b'});
  });

  it('keeps the FIRST of two cookies sharing a name', () => {
    expect(parseCookies('sid=real; sid=injected')).toEqual({sid: 'real'});
    expect(parseCookies('sid=real; other=1; sid=injected')).toEqual({sid: 'real', other: '1'});
  });

  it('does not let a cookie name reach Object.prototype', () => {
    const parsed = parseCookies('__proto__=polluted; constructor=x; toString=y');

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    // oxlint-disable-next-line no-proto -- reading the polluted key back is the assertion
    expect(parsed.__proto__).toBe('polluted');
  });
});
