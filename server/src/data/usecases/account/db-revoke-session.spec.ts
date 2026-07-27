import { describe, expect, it } from 'vitest'
import { DbRevokeSession } from './db-revoke-session.js'
import { mockDeleteSessionRepository } from '../../test/index.js'

const makeSut = () => {
  const deleteSessionRepository = mockDeleteSessionRepository()
  const sut = new DbRevokeSession(deleteSessionRepository)
  return { sut, deleteSessionRepository }
}

describe('DbRevokeSession', () => {
  it('deletes the session by id', async () => {
    const { sut, deleteSessionRepository } = makeSut()

    await sut.revoke('a-session-id')

    expect(deleteSessionRepository.deleteById).toHaveBeenCalledWith('a-session-id')
  })
})
