import { describe, expect, it } from 'vitest'
import { DbAddAccount } from './db-add-account.js'
import { mockAddAccountRepository, mockHasher, mockStartSession } from '../../test/index.js'

const makeSut = () => {
  const hasher = mockHasher()
  const addAccountRepository = mockAddAccountRepository()
  const startSession = mockStartSession()
  const sut = new DbAddAccount(hasher, addAccountRepository, startSession)
  return { sut, hasher, addAccountRepository, startSession }
}

const params = { email: 'a@b.co', password: 'correct horse battery staple' }

describe('DbAddAccount', () => {
  it('hashes the password and never passes the plaintext to the repository', async () => {
    const { sut, hasher, addAccountRepository } = makeSut()

    await sut.add(params)

    expect(hasher.hash).toHaveBeenCalledWith(params.password)
    expect(addAccountRepository.add).toHaveBeenCalledWith({
      email: params.email, passwordDigest: 'hashed'
    })
  })

  it('starts a session for the new account', async () => {
    const { sut, startSession } = makeSut()

    const result = await sut.add(params)

    expect(startSession.start).toHaveBeenCalledTimes(1)
    expect(result?.sessionId).toBe('any-session-id')
  })

  it('returns null and starts no session when the email is already registered', async () => {
    const { sut, addAccountRepository, startSession } = makeSut()
    addAccountRepository.add.mockResolvedValueOnce(null)

    expect(await sut.add(params)).toBeNull()
    expect(startSession.start).not.toHaveBeenCalled()
  })

  it('propagates a hashing failure rather than creating an account', async () => {
    const { sut, hasher, addAccountRepository } = makeSut()
    hasher.hash.mockRejectedValueOnce(new Error('hashing blew up'))

    await expect(sut.add(params)).rejects.toThrow('hashing blew up')
    expect(addAccountRepository.add).not.toHaveBeenCalled()
  })
})
