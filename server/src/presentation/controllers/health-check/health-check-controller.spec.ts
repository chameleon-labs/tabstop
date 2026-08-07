import {describe, expect, it, vi} from 'vitest';
import {HealthCheckController} from './health-check-controller.js';
import {mockHealthCheck, mockHealthCheckModel} from '../../test/mock-health-check.js';

const makeSut = () => {
  const healthCheck = mockHealthCheck();
  const sut = new HealthCheckController(healthCheck);
  return {sut, healthCheck};
};

describe('HealthCheckController', () => {
  it('returns 200 with the health check result when status is up', async () => {
    const {sut, healthCheck} = makeSut();
    const expectedModel = mockHealthCheckModel();
    vi.mocked(healthCheck.check).mockResolvedValueOnce(expectedModel);

    const response = await sut.handle();

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expectedModel);
  });

  it('returns 503 with the same body when status is degraded', async () => {
    const {sut, healthCheck} = makeSut();
    const degraded = mockHealthCheckModel({status: 'degraded', database: 'down'});
    vi.mocked(healthCheck.check).mockResolvedValueOnce(degraded);

    const response = await sut.handle();

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual(degraded);
  });

  it('returns 500 if HealthCheck throws', async () => {
    const {sut, healthCheck} = makeSut();
    vi.mocked(healthCheck.check).mockRejectedValueOnce(new Error('boom'));

    const response = await sut.handle();

    expect(response.statusCode).toBe(500);
  });
});
