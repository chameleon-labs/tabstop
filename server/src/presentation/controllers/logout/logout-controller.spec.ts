import {describe, expect, it} from 'vitest';
import {LogoutController} from './logout-controller.js';
import {mockRevokeSession} from '../../test/mock-account.js';

const makeSut = () => {
  const revokeSession = mockRevokeSession();
  const sut = new LogoutController(revokeSession, 'sid');
  return {sut, revokeSession};
};

describe('LogoutController', () => {
  it('revokes the session and clears the cookie', async () => {
    const {sut, revokeSession} = makeSut();

    const response = await sut.handle({cookies: {sid: 'a-session-id'}});

    expect(revokeSession.revoke).toHaveBeenCalledWith('a-session-id');
    expect(response.statusCode).toBe(204);
    expect(response.cookies).toEqual([{action: 'clear', name: 'sid'}]);
  });

  it('is idempotent without a cookie: 204, and nothing revoked', async () => {
    // Deliberately not behind the auth middleware, so that logging out twice -
    // or logging out with an already-dead session - is never an error.
    const {sut, revokeSession} = makeSut();

    const response = await sut.handle({cookies: {}});

    expect(response.statusCode).toBe(204);
    expect(revokeSession.revoke).not.toHaveBeenCalled();
    expect(response.cookies).toEqual([{action: 'clear', name: 'sid'}]);
  });

  it('ignores an empty cookie value', async () => {
    const {sut, revokeSession} = makeSut();

    const response = await sut.handle({cookies: {sid: ''}});

    expect(response.statusCode).toBe(204);
    expect(revokeSession.revoke).not.toHaveBeenCalled();
  });

  it('returns 500 when revocation throws', async () => {
    const {sut, revokeSession} = makeSut();
    revokeSession.revoke.mockRejectedValueOnce(new Error('database down'));

    const response = await sut.handle({cookies: {sid: 'a-session-id'}});

    expect(response.statusCode).toBe(500);
  });
});
