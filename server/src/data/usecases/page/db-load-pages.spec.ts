import {describe, expect, it, vi} from 'vitest';
import {nextReauditAt} from '../../../domain/services/reaudit-schedule.js';
import {DbDeletePage} from './db-delete-page.js';
import {DbLoadPages} from './db-load-pages.js';
import {DbUpdatePage} from './db-update-page.js';
import {
  mockDeletePageRepository,
  mockLoadPageSummariesRepository,
  mockPageSummary,
  mockSetPageMonitoringRepository,
} from '../../test/index.js';

describe('DbLoadPages', () => {
  it("returns the account's summaries alongside the cap the dashboard renders", async () => {
    const repository = mockLoadPageSummariesRepository();
    const sut = new DbLoadPages(repository, 10);

    expect(await sut.load('user-1')).toEqual({pages: [{...mockPageSummary(), nextAuditAt: null}], limit: 10});
    expect(repository.loadSummariesForUser).toHaveBeenCalledWith('user-1');
  });

  it('attaches the schedule the repository cannot know', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-08-01T23:00:00.000Z');
    vi.setSystemTime(now);
    const summary = {...mockPageSummary(), latestAudit: null};
    const repository = mockLoadPageSummariesRepository();
    repository.loadSummariesForUser.mockResolvedValueOnce([summary]);

    const result = await new DbLoadPages(repository, 10).load('user-1');

    expect(result.pages[0]?.nextAuditAt?.toISOString()).toBe(
      nextReauditAt(
        {domain: summary.domain, pageId: summary.page.id, monitoringEnabled: true, latest: null},
        now,
      )?.toISOString(),
    );
    vi.useRealTimers();
  });

  it('leaves a paused page without one', async () => {
    const repository = mockLoadPageSummariesRepository();
    const paused = mockPageSummary();
    repository.loadSummariesForUser.mockResolvedValueOnce([
      {...paused, page: {...paused.page, monitoringEnabled: false}},
    ]);

    expect((await new DbLoadPages(repository, 10).load('user-1')).pages[0]?.nextAuditAt).toBeNull();
  });

  it('still reports the cap for an account with no pages', async () => {
    const repository = mockLoadPageSummariesRepository();
    repository.loadSummariesForUser.mockResolvedValueOnce([]);

    expect(await new DbLoadPages(repository, 10).load('user-1')).toEqual({pages: [], limit: 10});
  });
});

describe('DbUpdatePage', () => {
  it('passes both ids to the repository, never the page id alone', async () => {
    const repository = mockSetPageMonitoringRepository();
    const sut = new DbUpdatePage(repository);

    const updated = await sut.update({
      pageId: 'page-1',
      userId: 'user-1',
      monitoringEnabled: false,
    });

    expect(repository.setMonitoringForUser).toHaveBeenCalledWith('page-1', 'user-1', false);
    expect(updated?.monitoringEnabled).toBe(false);
  });

  it('returns null when the account has no such page', async () => {
    const repository = mockSetPageMonitoringRepository();
    repository.setMonitoringForUser.mockResolvedValueOnce(null);

    expect(
      await new DbUpdatePage(repository).update({
        pageId: 'page-1',
        userId: 'someone-else',
        monitoringEnabled: true,
      }),
    ).toBeNull();
  });
});

describe('DbDeletePage', () => {
  it('passes both ids to the repository, never the page id alone', async () => {
    const repository = mockDeletePageRepository();

    expect(await new DbDeletePage(repository).delete({pageId: 'page-1', userId: 'user-1'})).toBe(true);
    expect(repository.deleteForUser).toHaveBeenCalledWith('page-1', 'user-1');
  });

  it('returns false when the account has no such page', async () => {
    const repository = mockDeletePageRepository();
    repository.deleteForUser.mockResolvedValueOnce(false);

    expect(
      await new DbDeletePage(repository).delete({
        pageId: 'page-1',
        userId: 'someone-else',
      }),
    ).toBe(false);
  });
});
