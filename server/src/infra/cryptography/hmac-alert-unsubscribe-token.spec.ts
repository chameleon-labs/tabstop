import { describe, expect, it } from 'vitest'
import { HmacAlertUnsubscribeToken } from './hmac-alert-unsubscribe-token.js'

describe('HmacAlertUnsubscribeToken', () => {
  const sut = new HmacAlertUnsubscribeToken('a'.repeat(64))

  it('round-trips a page-scoped token', () => {
    const token = sut.encode('42')

    expect(token).toMatch(/^v1\.42\.[A-Za-z0-9_-]{43}$/)
    expect(sut.decode(token)).toBe('42')
  })

  it('rejects a token whose page id was changed', () => {
    const token = sut.encode('42')

    expect(sut.decode(token.replace('v1.42.', 'v1.43.'))).toBeNull()
  })

  it('rejects malformed and out-of-range page ids', () => {
    expect(sut.decode('v1.not-a-number.signature')).toBeNull()
    expect(sut.decode(sut.encode('42').replace('v1.42.', 'v1.00042.'))).toBeNull()
    expect(() => sut.encode('9223372036854775808')).toThrow('page id')
  })
})
