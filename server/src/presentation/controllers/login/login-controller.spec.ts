import {describe, expect, it} from 'vitest';
import {LoginController} from './login-controller.js';
import {mockAuthenticate, mockValidation} from '../../test/mock-account.js';

const request = {email: 'a@b.co', password: 'correct horse battery staple'};

const makeSut = () => {
  const validation = mockValidation(request);
  const authenticate = mockAuthenticate();
  const sut = new LoginController(validation, authenticate, 'sid');
  return {sut, validation, authenticate};
};

describe('LoginController', () => {
  it('returns 200 with the account view and a session cookie', async () => {
    const {sut} = makeSut();

    const response = await sut.handle(request);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      id: 'any-user-id',
      email: 'any@example.test',
      alertThreshold: 5,
    });
    expect(response.cookies).toEqual([
      {
        action: 'set',
        name: 'sid',
        value: 'any-session-id',
        expiresAt: new Date('2026-08-25T00:00:00Z'),
      },
    ]);
  });

  it('returns 400 without calling the usecase when validation fails', async () => {
    const {sut, validation, authenticate} = makeSut();
    validation.validate.mockReturnValueOnce({error: new Error('email: Invalid email address')});

    const response = await sut.handle({});

    expect(response.statusCode).toBe(400);
    expect(authenticate.auth).not.toHaveBeenCalled();
  });

  it('returns one indistinguishable 401 for bad credentials', async () => {
    // The usecase cannot tell the controller whether the email was unknown or
    // the password wrong, so the response cannot leak it either.
    const {sut, authenticate} = makeSut();
    authenticate.auth.mockResolvedValueOnce(null);

    const response = await sut.handle(request);

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({error: 'Invalid email or password'});
    expect(response.cookies).toBeUndefined();
  });

  it('returns 500 when the usecase throws', async () => {
    const {sut, authenticate} = makeSut();
    authenticate.auth.mockRejectedValueOnce(new Error('database down'));

    const response = await sut.handle(request);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({error: 'Internal server error'});
  });
});
