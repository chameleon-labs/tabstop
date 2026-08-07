import {describe, expect, it, vi} from 'vitest';
import {HealthCheckUseCase} from './health-check.js';
import {mockUptimeProvider, mockDatabaseHealthProvider} from '../../test/index.js';

const makeSut = () => {
  const uptimeProvider = mockUptimeProvider();
  const databaseHealthProvider = mockDatabaseHealthProvider();
  const sut = new HealthCheckUseCase(uptimeProvider, databaseHealthProvider);
  return {sut, uptimeProvider, databaseHealthProvider};
};

describe('HealthCheckUseCase', () => {
  it('returns status up with the uptime from UptimeProvider', async () => {
    const {sut, uptimeProvider} = makeSut();

    const result = await sut.check();

    expect(result.status).toBe('up');
    expect(result.uptimeInSeconds).toBe(uptimeProvider.getUptimeInSeconds());
  });

  it('reports the database as up when the provider says it is reachable', async () => {
    const {sut} = makeSut();

    const result = await sut.check();

    expect(result.database).toBe('up');
  });

  it('reports degraded and database down when the provider says it is unreachable', async () => {
    const {sut, databaseHealthProvider} = makeSut();
    vi.mocked(databaseHealthProvider.isReachable).mockResolvedValueOnce(false);

    const result = await sut.check();

    expect(result.status).toBe('degraded');
    expect(result.database).toBe('down');
  });

  it('probes the database exactly once per check', async () => {
    const {sut, databaseHealthProvider} = makeSut();

    await sut.check();

    expect(databaseHealthProvider.isReachable).toHaveBeenCalledTimes(1);
  });

  it('returns a checkedAt timestamp close to now', async () => {
    const {sut} = makeSut();

    const before = Date.now();
    const result = await sut.check();
    const after = Date.now();

    const checkedAt = new Date(result.checkedAt).getTime();
    expect(checkedAt).toBeGreaterThanOrEqual(before);
    expect(checkedAt).toBeLessThanOrEqual(after);
  });
});
