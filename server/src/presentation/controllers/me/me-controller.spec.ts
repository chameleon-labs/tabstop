import {describe, expect, it} from 'vitest';
import {MeController} from './me-controller.js';
import {mockAccountModel} from '../../test/mock-account.js';

describe('MeController', () => {
  it('returns the account the auth middleware already resolved', async () => {
    const sut = new MeController();

    const response = await sut.handle({account: mockAccountModel()});

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      id: 'any-user-id',
      email: 'any@example.test',
      alertThreshold: 5,
    });
  });

  it('does not expose createdAt', async () => {
    const sut = new MeController();

    const response = await sut.handle({account: mockAccountModel()});

    expect(response.body).not.toHaveProperty('createdAt');
  });
});
