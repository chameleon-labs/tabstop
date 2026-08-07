import {describe, expect, it} from 'vitest';
import {DbLoadAccountBySession} from './db-load-account-by-session.js';
import {mockAccountModel, mockLoadAccountBySessionIdRepository} from '../../test/index.js';

const makeSut = () => {
  const loadAccountBySessionIdRepository = mockLoadAccountBySessionIdRepository();
  const sut = new DbLoadAccountBySession(loadAccountBySessionIdRepository);
  return {sut, loadAccountBySessionIdRepository};
};

describe('DbLoadAccountBySession', () => {
  it('returns the account behind the session id', async () => {
    const {sut, loadAccountBySessionIdRepository} = makeSut();

    const result = await sut.load('a-session-id');

    expect(loadAccountBySessionIdRepository.loadBySessionId).toHaveBeenCalledWith('a-session-id');
    expect(result).toEqual(mockAccountModel());
  });

  it('returns null when the repository finds nothing', async () => {
    const {sut, loadAccountBySessionIdRepository} = makeSut();
    loadAccountBySessionIdRepository.loadBySessionId.mockResolvedValueOnce(null);

    expect(await sut.load('a-session-id')).toBeNull();
  });
});
