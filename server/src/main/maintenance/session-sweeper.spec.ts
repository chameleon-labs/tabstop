import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {startSessionSweeper} from './session-sweeper.js';

type DeleteExpired = () => Promise<number>;

const mockSessions = (deleteExpired: DeleteExpired = () => Promise.resolve(0)) => ({
  deleteExpired: vi.fn<DeleteExpired>(deleteExpired),
});

describe('startSessionSweeper', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports a pass that found nothing, so a sweeper that stopped is noticeable', async () => {
    const sweeper = startSessionSweeper(mockSessions(), 1000);

    await vi.advanceTimersByTimeAsync(1000);

    expect(log).toHaveBeenCalledWith('Session sweep removed 0 expired session(s)');
    sweeper.stop();
  });

  it('reports how many it removed', async () => {
    const sweeper = startSessionSweeper(
      mockSessions(() => Promise.resolve(7)),
      1000,
    );

    await vi.advanceTimersByTimeAsync(1000);

    expect(log).toHaveBeenCalledWith('Session sweep removed 7 expired session(s)');
    sweeper.stop();
  });

  it('does not sweep on boot', () => {
    const sessions = mockSessions();

    const sweeper = startSessionSweeper(sessions, 1000);

    expect(sessions.deleteExpired).not.toHaveBeenCalled();
    sweeper.stop();
  });

  it('sweeps once per interval', async () => {
    const sessions = mockSessions();
    const sweeper = startSessionSweeper(sessions, 1000);

    await vi.advanceTimersByTimeAsync(3000);

    expect(sessions.deleteExpired).toHaveBeenCalledTimes(3);
    sweeper.stop();
  });

  it('keeps sweeping after a failure', async () => {
    const sessions = mockSessions(() => Promise.reject(new Error('database down')));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sweeper = startSessionSweeper(sessions, 1000);

    await vi.advanceTimersByTimeAsync(2000);

    expect(sessions.deleteExpired).toHaveBeenCalledTimes(2);
    sweeper.stop();
  });

  it('never runs two sweeps at once, however long one takes', async () => {
    let release = (): void => undefined;
    const blocked = new Promise<number>((resolve) => {
      release = () => {
        resolve(0);
      };
    });
    const sessions = mockSessions(async () => await blocked);

    const sweeper = startSessionSweeper(sessions, 1000);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sessions.deleteExpired).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sessions.deleteExpired).toHaveBeenCalledTimes(2);

    sweeper.stop();
  });

  it('stops when told to', async () => {
    const sessions = mockSessions();
    const sweeper = startSessionSweeper(sessions, 1000);

    await vi.advanceTimersByTimeAsync(1000);
    sweeper.stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(sessions.deleteExpired).toHaveBeenCalledTimes(1);
  });
});
