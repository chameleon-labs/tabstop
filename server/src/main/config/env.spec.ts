import { describe, expect, it } from 'vitest'
import { parseEnv } from './env.js'

const validSource = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  FRONTEND_ORIGIN: 'http://localhost:5173',
  SESSION_COOKIE_SECURE: 'false'
}

describe('parseEnv', () => {
  it('returns the parsed port when PORT is a valid number', () => {
    const result = parseEnv({ ...validSource, PORT: '4000' })

    expect(result.port).toBe(4000)
  })

  it('preserves PORT=0 rather than falling back', () => {
    const result = parseEnv({ ...validSource, PORT: '0' })

    expect(result.port).toBe(0)
  })

  it('falls back to 3000 when PORT is absent or empty', () => {
    expect(parseEnv({ ...validSource }).port).toBe(3000)
    expect(parseEnv({ ...validSource, PORT: '' }).port).toBe(3000)
  })

  it('falls back to 3000 when PORT is not a number', () => {
    expect(parseEnv({ ...validSource, PORT: 'nonsense' }).port).toBe(3000)
  })

  it('returns DATABASE_URL when set', () => {
    const result = parseEnv(validSource)

    expect(result.databaseUrl).toBe('postgres://user:pass@localhost:5432/db')
  })

  it('throws when DATABASE_URL is missing', () => {
    expect(() => parseEnv({})).toThrow('DATABASE_URL')
  })

  it('throws when DATABASE_URL is empty', () => {
    expect(() => parseEnv({ DATABASE_URL: '' })).toThrow('DATABASE_URL')
  })

  it('returns REDIS_URL when set', () => {
    const result = parseEnv(validSource)

    expect(result.redisUrl).toBe('redis://localhost:6379')
  })

  it('throws when REDIS_URL is missing', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgres://x' })).toThrow('REDIS_URL')
  })

  it('throws when FRONTEND_ORIGIN is missing', () => {
    const { FRONTEND_ORIGIN, ...rest } = validSource
    expect(() => parseEnv(rest)).toThrow('FRONTEND_ORIGIN')
  })

  it('throws when SESSION_COOKIE_SECURE is missing', () => {
    const { SESSION_COOKIE_SECURE, ...rest } = validSource
    expect(() => parseEnv(rest)).toThrow('SESSION_COOKIE_SECURE')
  })

  it('rejects a SESSION_COOKIE_SECURE that is neither true nor false', () => {
    expect(() => parseEnv({ ...validSource, SESSION_COOKIE_SECURE: 'yes' }))
      .toThrow('SESSION_COOKIE_SECURE must be "true" or "false"')
  })

  it('parses SESSION_COOKIE_SECURE as a boolean', () => {
    expect(parseEnv({ ...validSource, SESSION_COOKIE_SECURE: 'true' }).sessionCookieSecure).toBe(true)
    expect(parseEnv({ ...validSource, SESSION_COOKIE_SECURE: 'false' }).sessionCookieSecure).toBe(false)
  })

  it('defaults the scrypt cost and session ttl, ignoring nonsense', () => {
    expect(parseEnv(validSource).scryptCost).toBe(32768)
    expect(parseEnv(validSource).sessionTtlDays).toBe(30)
    expect(parseEnv({ ...validSource, SCRYPT_COST: 'nonsense' }).scryptCost).toBe(32768)
    expect(parseEnv({ ...validSource, SCRYPT_COST: '0' }).scryptCost).toBe(32768)
    expect(parseEnv({ ...validSource, SCRYPT_COST: '16384' }).scryptCost).toBe(16384)
  })

  it('throws when REDIS_URL is empty', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgres://x', REDIS_URL: '' })).toThrow('REDIS_URL')
  })
})
