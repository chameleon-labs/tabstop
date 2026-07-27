import { describe, expect, it } from 'vitest'
import { DbAuthenticate } from './db-authenticate.js'
import {
  mockHashComparer, mockHasher, mockLoadAccountByEmailRepository, mockStartSession
} from '../../test/index.js'

const makeSut = () => {
  const loadAccountByEmailRepository = mockLoadAccountByEmailRepository()
  const hasher = mockHasher()
  const hashComparer = mockHashComparer()
  const startSession = mockStartSession()
  const sut = new DbAuthenticate(
    loadAccountByEmailRepository, hasher, hashComparer, startSession
  )
  return { sut, loadAccountByEmailRepository, hasher, hashComparer, startSession }
}

const params = { email: 'a@b.co', password: 'correct horse battery staple' }

describe('DbAuthenticate', () => {
  it('compares the password against the stored digest and starts a session', async () => {
    const { sut, hashComparer, startSession } = makeSut()

    const result = await sut.auth(params)

    expect(hashComparer.compare).toHaveBeenCalledWith(params.password, 'stored-digest')
    expect(startSession.start).toHaveBeenCalledTimes(1)
    expect(result?.sessionId).toBe('any-session-id')
  })

  it('still performs a comparison when the email is unknown', async () => {
    // Without this, an unknown email returns in ~0ms and a known one in ~89ms,
    // and the deliberate choice to return one identical error for both cases
    // is undone by a stopwatch.
    const { sut, loadAccountByEmailRepository, hashComparer } = makeSut()
    loadAccountByEmailRepository.loadByEmail.mockResolvedValueOnce(null)

    const result = await sut.auth({ email: 'nobody@test.test', password: 'whatever' })

    expect(result).toBeNull()
    expect(hashComparer.compare).toHaveBeenCalledTimes(1)
  })

  it('hashes the dummy digest only once across many unknown-email attempts', async () => {
    const { sut, loadAccountByEmailRepository, hasher } = makeSut()
    loadAccountByEmailRepository.loadByEmail.mockResolvedValue(null)

    await sut.auth({ email: 'a@test.test', password: 'x' })
    await sut.auth({ email: 'b@test.test', password: 'x' })
    await sut.auth({ email: 'c@test.test', password: 'x' })

    expect(hasher.hash).toHaveBeenCalledTimes(1)
  })

  it('returns null on a wrong password without starting a session', async () => {
    const { sut, hashComparer, startSession } = makeSut()
    hashComparer.compare.mockResolvedValueOnce(false)

    expect(await sut.auth(params)).toBeNull()
    expect(startSession.start).not.toHaveBeenCalled()
  })
})
