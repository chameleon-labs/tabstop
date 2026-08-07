import {describe, expect, it} from 'vitest';
import {parseCookies} from './cookies.js';

describe('parseCookies', () => {
  it('parses a header into name/value pairs', () => {
    expect(parseCookies('sid=abc; other=1')).toEqual({sid: 'abc', other: '1'});
  });

  it('survives absent, empty and malformed headers', () => {
    // Express 5 ships no cookie parser, so this runs on every request and must
    // never throw on input a client fully controls.
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
    // RFC 6265 orders the header most-specific-first, so the first value is
    // the one the browser considers the closest match. Taking the last instead
    // hands the decision to whoever appended - and a duplicate `sid` is not a
    // typo, it is someone trying to replace a session. `__Host-` is what keeps
    // this out of reach in production; over plain http in development, and for
    // any future cookie that cannot carry the prefix, the parser should not be
    // the weak link.
    expect(parseCookies('sid=real; sid=injected')).toEqual({sid: 'real'});
    expect(parseCookies('sid=real; other=1; sid=injected')).toEqual({sid: 'real', other: '1'});
  });

  it('does not let a cookie name reach Object.prototype', () => {
    // The name is fully client-controlled and is used as a key immediately.
    const parsed = parseCookies('__proto__=polluted; constructor=x; toString=y');

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(parsed.__proto__).toBe('polluted');
  });
});
