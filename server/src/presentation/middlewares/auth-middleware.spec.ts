import {describe, expect, it} from 'vitest';
import {AuthMiddleware} from './auth-middleware.js';
import {mockAccountModel, mockLoadAccountBySession} from '../test/mock-account.js';

const makeSut = () => {
  const loadAccountBySession = mockLoadAccountBySession();
  const sut = new AuthMiddleware(loadAccountBySession, 'sid');
  return {sut, loadAccountBySession};
};

describe('AuthMiddleware', () => {
  it('returns both userId and account, so /api/me needs no second lookup', async () => {
    const {sut, loadAccountBySession} = makeSut();

    const response = await sut.handle({cookies: {sid: 'a-session-id'}});

    expect(loadAccountBySession.load).toHaveBeenCalledWith('a-session-id');
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({userId: 'any-user-id', account: mockAccountModel()});
  });

  it('returns 401 when no session cookie is present', async () => {
    const {sut, loadAccountBySession} = makeSut();

    const response = await sut.handle({cookies: {}});

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({error: 'Unauthorized'});
    expect(loadAccountBySession.load).not.toHaveBeenCalled();
  });

  it('returns 401 for an empty cookie value', async () => {
    const {sut, loadAccountBySession} = makeSut();

    const response = await sut.handle({cookies: {sid: ''}});

    expect(response.statusCode).toBe(401);
    expect(loadAccountBySession.load).not.toHaveBeenCalled();
  });

  it('returns 401 when the session is unknown or expired', async () => {
    // The repository enforces expiry in SQL, so both cases arrive here as null.
    const {sut, loadAccountBySession} = makeSut();
    loadAccountBySession.load.mockResolvedValueOnce(null);

    const response = await sut.handle({cookies: {sid: 'a-dead-session'}});

    expect(response.statusCode).toBe(401);
  });

  it('returns 500 when the lookup throws', async () => {
    const {sut, loadAccountBySession} = makeSut();
    loadAccountBySession.load.mockRejectedValueOnce(new Error('database down'));

    const response = await sut.handle({cookies: {sid: 'a-session-id'}});

    expect(response.statusCode).toBe(500);
  });
});
