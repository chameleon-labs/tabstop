import { describe, expect, it } from 'vitest'
import { sessionCookieName } from './session-cookie.js'

describe('sessionCookieName', () => {
  it('uses the __Host- prefix wherever the cookie is Secure', () => {
    // Browsers reject a __Host- cookie that carries a Domain attribute, which
    // is what prevents a sibling subdomain from overwriting the session.
    expect(sessionCookieName(true)).toBe('__Host-sid')
  })

  it('falls back to a bare name over plain http, where the prefix is invalid', () => {
    expect(sessionCookieName(false)).toBe('sid')
  })
})
