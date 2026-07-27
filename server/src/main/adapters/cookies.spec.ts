import { describe, expect, it } from 'vitest'
import { parseCookies } from './cookies.js'

describe('parseCookies', () => {
  it('parses a header into name/value pairs', () => {
    expect(parseCookies('sid=abc; other=1')).toEqual({ sid: 'abc', other: '1' })
  })

  it('survives absent, empty and malformed headers', () => {
    // Express 5 ships no cookie parser, so this runs on every request and must
    // never throw on input a client fully controls.
    expect(parseCookies(undefined)).toEqual({})
    expect(parseCookies('')).toEqual({})
    expect(parseCookies('novalue')).toEqual({})
    expect(parseCookies('=orphaned')).toEqual({})
  })

  it('trims surrounding whitespace and keeps "=" inside a value', () => {
    expect(parseCookies('  sid = spaced  ')).toEqual({ sid: 'spaced' })
    expect(parseCookies('sid=a=b')).toEqual({ sid: 'a=b' })
  })
})
