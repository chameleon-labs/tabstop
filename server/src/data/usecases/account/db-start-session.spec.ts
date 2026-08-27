import {describe, expect, it} from 'vitest';
import {DbStartSession} from './db-start-session.js';
import {mockAccountModel, mockAddSessionRepository, mockSessionIdGenerator} from '../../test/index.js';

const TTL_DAYS = 30;

const makeSut = () => {
  const sessionIdGenerator = mockSessionIdGenerator();
  const addSessionRepository = mockAddSessionRepository();
  const sut = new DbStartSession(sessionIdGenerator, addSessionRepository, TTL_DAYS);
  return {sut, sessionIdGenerator, addSessionRepository};
};

describe('DbStartSession', () => {
  it('persists a generated id for the account, expiring after the configured ttl', async () => {
    const {sut, addSessionRepository} = makeSut();
    const account = mockAccountModel();
    const before = Date.now();

    await sut.start(account);

    expect(addSessionRepository.add).toHaveBeenCalledTimes(1);
    const params = addSessionRepository.add.mock.calls[0]?.[0];
    expect(params?.id).toBe('generated-session-id');
    expect(params?.userId).toBe(account.id);
    const expectedMs = TTL_DAYS * 24 * 60 * 60 * 1000;
    expect(params?.expiresAt.getTime()).toBeGreaterThanOrEqual(before + expectedMs);
  });

  it('reports the expiry the repository persisted, not the one it proposed', async () => {
    const {sut, addSessionRepository} = makeSut();
    const persisted = new Date('2027-01-01T00:00:00Z');
    addSessionRepository.add.mockResolvedValueOnce({
      id: 'generated-session-id',
      userId: 'any-user-id',
      createdAt: new Date(),
      expiresAt: persisted,
    });

    const result = await sut.start(mockAccountModel());

    expect(result.expiresAt).toBe(persisted);
  });

  it('returns the account it was given', async () => {
    const {sut} = makeSut();
    const account = mockAccountModel();

    const result = await sut.start(account);

    expect(result.account).toEqual(account);
    expect(result.sessionId).toBe('generated-session-id');
  });
});
