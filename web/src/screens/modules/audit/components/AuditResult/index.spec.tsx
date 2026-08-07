import type {AuditResultResponse} from '@tabstop/contract';
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {AuditResult} from './index';

const audit = (over: Partial<AuditResultResponse> = {}): AuditResultResponse => ({
  auditId: 'abc',
  url: 'https://example.com/',
  status: 'done',
  createdAt: '2026-08-03T09:00:00.000Z',
  completedAt: '2026-08-03T09:00:30.000Z',
  score: 72,
  countsByImpact: {minor: 1, moderate: 2, serious: 3, critical: 4},
  axeVersion: '4.12.1',
  settled: true,
  error: null,
  violations: [],
  ...over,
});

describe('AuditResult', () => {
  it('names the page it is a result for', () => {
    render(<AuditResult audit={audit()} />);

    expect(screen.getByRole('heading', {level: 2})).toHaveTextContent('https://example.com/');
  });

  describe('the score', () => {
    it('is never shown without the counts beside it', () => {
      // The counts are not decoration, they are the correction. A lone number
      // invites "72 is a B-", and the score exists for noticing regressions
      // rather than for grading a site - two pages can score identically with
      // very different problems.
      render(<AuditResult audit={audit()} />);

      expect(screen.getByText('72')).toBeVisible();
      for (const label of ['Critical', 'Serious', 'Moderate', 'Minor']) {
        expect(screen.getByText(label)).toBeVisible();
      }
    });

    it('shows every count, including the zeroes', () => {
      // A zero is information here, unlike an empty violation group: "no
      // critical issues" is the thing someone most wants confirmed.
      render(
        <AuditResult
          audit={audit({
            countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
          })}
        />,
      );

      expect(screen.getAllByText('0')).toHaveLength(4);
    });

    it('says so rather than showing nothing when there is no score', () => {
      render(<AuditResult audit={audit({score: null})} />);

      expect(screen.getByText('Not scored')).toBeVisible();
    });

    it('pairs each count with its label programmatically', () => {
      // A description list, so the association survives without the visual
      // layout that usually carries it.
      render(<AuditResult audit={audit()} />);

      const term = screen.getByText('Critical');
      expect(term.tagName).toBe('DT');
      expect(term.nextElementSibling?.textContent).toBe('4');
    });
  });

  describe('an unsettled page', () => {
    it('says the results are provisional', () => {
      // `settled: false` means the page never finished loading, so everything
      // above was measured against a page still in motion. Publishing a clean
      // score from it silently would be the product asserting something it does
      // not know - on a page someone shares with a colleague.
      render(<AuditResult audit={audit({settled: false})} />);

      expect(screen.getByRole('note')).toHaveTextContent(/provisional/);
    });

    it('says nothing extra when the page did settle', () => {
      render(<AuditResult audit={audit({settled: true})} />);

      expect(screen.queryByRole('note')).not.toBeInTheDocument();
    });
  });

  it('renders the violations underneath', () => {
    render(
      <AuditResult
        audit={audit({
          violations: [
            {
              ruleId: 'image-alt',
              impact: 'critical',
              description: 'Images need alt text',
              helpUrl: 'https://example.test',
              nodes: [],
            },
          ],
        })}
      />,
    );

    expect(screen.getByRole('heading', {level: 3, name: 'Critical (1)'})).toBeVisible();
    expect(screen.getByRole('button', {name: 'Images need alt text'})).toBeVisible();
  });

  it('needs nothing but a response, so #23 can render it too', () => {
    // No router, no query client, no knowledge of how it was reached. The share
    // page and audit detail render this same component; a dependency on either
    // of those would make it unusable in the other.
    expect(() => render(<AuditResult audit={audit()} />)).not.toThrow();
  });
});
