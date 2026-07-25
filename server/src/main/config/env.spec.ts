import { describe, expect, it } from 'vitest'
import { parseEnv } from './env.js'

const validSource = { DATABASE_URL: 'postgres://user:pass@localhost:5432/db' }

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
})
