import {renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {AuditStatus, PageScorePoint, PageSummary} from '@tabstop/contract';
import {usePageAuditToasts} from './use-page-audit-toasts';

const page = (
  id: string,
  status: AuditStatus | null,
  history: PageScorePoint[] = [],
  auditId = `audit-${id}`,
  score: number | null = null,
): PageSummary => ({
  id,
  url: `https://example.test/${id}`,
  monitoringEnabled: true,
  createdAt: '2026-08-01T10:00:00.000Z',
  domain: 'example.test',
  latestAudit:
    status === null
      ? null
      : {
          auditId,
          status,
          score,
          countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
          createdAt: '2026-08-15T10:00:00.000Z',
          completedAt: status === 'done' || status === 'failed' ? '2026-08-15T10:01:00.000Z' : null,
          error: status === 'failed' ? 'Navigation timeout' : null,
        },
  score: history.at(-1)?.score ?? null,
  previousScore: history.at(-2)?.score ?? null,
  history,
  nextAuditAt: null,
});

const scored: PageScorePoint[] = [{score: 74, at: '2026-08-15T10:01:00.000Z'}];

const render = (initial: readonly PageSummary[] | undefined) => {
  const push = vi.fn();
  const view = renderHook(({pages}) => usePageAuditToasts(pages, push), {initialProps: {pages: initial}});

  return {push, rerender: (pages: readonly PageSummary[] | undefined) => view.rerender({pages})};
};

describe('usePageAuditToasts', () => {
  it('says nothing about rows that were already finished when the screen opened', () => {
    const {push} = render([page('a', 'done', scored), page('b', 'failed')]);

    expect(push).not.toHaveBeenCalled();
  });

  it('says nothing while a first audit is still queued', () => {
    const {push} = render([page('a', 'queued')]);

    expect(push).not.toHaveBeenCalled();
  });

  it('stays quiet as an audit moves from queued to running', () => {
    const {push, rerender} = render([page('a', 'queued')]);

    rerender([page('a', 'running')]);

    expect(push).not.toHaveBeenCalled();
  });

  it('announces a first audit finishing, once, with the url and the score', () => {
    const {push, rerender} = render([page('a', 'running')]);

    rerender([page('a', 'done', scored, 'audit-a', 74)]);

    expect(push).toHaveBeenCalledExactlyOnceWith({
      variant: 'success',
      message: 'First audit complete for https://example.test/a. Score 74.',
    });
  });

  it('announces a first audit failing as something to look at', () => {
    const {push, rerender} = render([page('a', 'running')]);

    rerender([page('a', 'failed')]);

    expect(push).toHaveBeenCalledExactlyOnceWith({
      variant: 'warning',
      message: 'First audit failed for https://example.test/a.',
    });
  });

  it('does not repeat itself when the same result arrives again', () => {
    const {push, rerender} = render([page('a', 'running')]);
    const finished = page('a', 'done', scored, 'audit-a', 74);

    rerender([finished]);
    rerender([finished]);
    rerender([finished]);

    expect(push).toHaveBeenCalledTimes(1);
  });

  it('says nothing when a later audit on an established page finishes', () => {
    const {push, rerender} = render([page('a', 'running', scored)]);

    rerender([page('a', 'done', [...scored, {score: 80, at: '2026-08-15T11:00:00.000Z'}], 'audit-a', 80)]);

    expect(push).not.toHaveBeenCalled();
  });

  it('follows a page by id rather than by its position in the list', () => {
    const {push, rerender} = render([page('a', 'done', scored), page('b', 'running')]);

    rerender([
      page('b', 'done', [{score: 91, at: '2026-08-15T10:01:00.000Z'}], 'audit-b', 91),
      page('a', 'done', scored),
    ]);

    expect(push).toHaveBeenCalledExactlyOnceWith({
      variant: 'success',
      message: 'First audit complete for https://example.test/b. Score 91.',
    });
  });

  it('says nothing when a page is removed', () => {
    const {push, rerender} = render([page('a', 'running'), page('b', 'running')]);

    rerender([page('b', 'running')]);

    expect(push).not.toHaveBeenCalled();
  });

  it('treats a new audit on the same page as a new thing to watch', () => {
    const {push, rerender} = render([page('a', 'running')]);

    rerender([page('a', 'running', [], 'audit-a2')]);
    rerender([page('a', 'done', scored, 'audit-a2', 74)]);

    expect(push).toHaveBeenCalledExactlyOnceWith({
      variant: 'success',
      message: 'First audit complete for https://example.test/a. Score 74.',
    });
  });

  it('waits for real data before deciding anything is a baseline', () => {
    const {push, rerender} = render(undefined);

    rerender([page('a', 'done', scored)]);

    expect(push).not.toHaveBeenCalled();
  });

  it('announces completion even when the score is missing', () => {
    const {push, rerender} = render([page('a', 'running')]);

    rerender([page('a', 'done', [])]);

    expect(push).toHaveBeenCalledExactlyOnceWith({
      variant: 'success',
      message: 'First audit complete for https://example.test/a.',
    });
  });
});
