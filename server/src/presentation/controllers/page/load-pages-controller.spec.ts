import {describe, expect, it} from 'vitest';
import {LoadPagesController} from './load-pages-controller.js';
import {mockLatestAudit, mockLoadPages, mockPageSummary} from '../../test/index.js';

const makeSut = () => {
  const loadPages = mockLoadPages();
  return {sut: new LoadPagesController(loadPages), loadPages};
};

describe('LoadPagesController', () => {
  it('returns every row the dashboard renders, plus the cap and the count', async () => {
    const {sut, loadPages} = makeSut();

    const response = await sut.handle({userId: 'user-1'});

    expect(loadPages.load).toHaveBeenCalledWith('user-1');
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      limit: 10,
      used: 1,
      pages: [
        {
          id: 'any-page-id',
          url: 'https://example.test/pricing',
          monitoringEnabled: true,
          createdAt: '2026-07-29T10:00:00.000Z',
          domain: 'example.test',
          latestAudit: {
            auditId: '22222222-2222-2222-2222-222222222222',
            status: 'done',
            score: 74,
            countsByImpact: {minor: 1, moderate: 2, serious: 0, critical: 1},
            createdAt: '2026-07-29T09:00:00.000Z',
            completedAt: '2026-07-29T09:00:30.000Z',
            error: null,
          },
          // The delta badge's two numbers, taken from the finished audits.
          score: 74,
          previousScore: 86,
          history: [
            {score: 86, at: '2026-07-27T09:00:00.000Z'},
            {score: 74, at: '2026-07-29T09:00:00.000Z'},
          ],
        },
      ],
    });
  });

  it('keeps the last finished score when the most recent run failed', async () => {
    // A page whose latest audit errored still has a trend worth showing, and
    // "-12 since yesterday" must not vanish because one run broke.
    const {sut, loadPages} = makeSut();
    loadPages.load.mockResolvedValueOnce({
      limit: 10,
      pages: [
        {
          ...mockPageSummary(),
          latestAudit: {
            ...mockLatestAudit(),
            status: 'failed',
            score: null,
            error: 'Navigation timed out',
          },
        },
      ],
    });

    const response = await sut.handle({userId: 'user-1'});
    const page = (response.body as {pages: Array<Record<string, unknown>>}).pages[0];

    expect(page).toMatchObject({
      score: 74,
      previousScore: 86,
      latestAudit: {status: 'failed', score: null, error: 'Navigation timed out'},
    });
  });

  it('reports a still-queued first audit rather than a null latestAudit', async () => {
    // Adding a page writes its first audit in the same transaction, so a page
    // seconds old already HAS one - queued, unscored. A client must not read
    // `latestAudit: null` as "nothing has finished yet" and sit waiting: null
    // means there is no audit row at all, which after #11 barely happens.
    const {sut, loadPages} = makeSut();
    loadPages.load.mockResolvedValueOnce({
      limit: 10,
      pages: [
        {
          ...mockPageSummary(),
          latestAudit: {...mockLatestAudit(), status: 'queued', score: null, completedAt: null},
          history: [],
        },
      ],
    });

    const response = await sut.handle({userId: 'user-1'});
    const page = (response.body as {pages: Array<Record<string, unknown>>}).pages[0];

    expect(page).toMatchObject({
      latestAudit: {status: 'queued', score: null, completedAt: null},
      score: null,
      previousScore: null,
      history: [],
    });
  });

  it('reports nulls rather than zeros for a page that has never finished an audit', async () => {
    const {sut, loadPages} = makeSut();
    loadPages.load.mockResolvedValueOnce({
      limit: 10,
      pages: [{...mockPageSummary(), latestAudit: null, history: []}],
    });

    const response = await sut.handle({userId: 'user-1'});

    expect((response.body as {pages: Array<Record<string, unknown>>}).pages[0]).toMatchObject({
      score: null,
      previousScore: null,
      latestAudit: null,
      history: [],
    });
  });

  it("reports the cap for an empty account, which is the empty state's copy", async () => {
    const {sut, loadPages} = makeSut();
    loadPages.load.mockResolvedValueOnce({limit: 10, pages: []});

    expect((await sut.handle({userId: 'user-1'})).body).toEqual({pages: [], limit: 10, used: 0});
  });

  it('returns 500 without leaking the failure when the usecase throws', async () => {
    const {sut, loadPages} = makeSut();
    loadPages.load.mockRejectedValueOnce(new Error('connection terminated unexpectedly'));

    const response = await sut.handle({userId: 'user-1'});

    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('connection terminated');
  });
});
