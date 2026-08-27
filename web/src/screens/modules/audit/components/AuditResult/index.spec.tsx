import type {AuditResultResponse} from '@tabstop/contract';
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {Providers} from '@/test/render';
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
    render(<AuditResult audit={audit()} />, {wrapper: Providers});

    expect(screen.getByRole('heading', {level: 2})).toHaveTextContent('https://example.com/');
  });

  describe('the score', () => {
    it('is never shown without the counts beside it', () => {
      render(<AuditResult audit={audit()} />, {wrapper: Providers});

      expect(screen.getByText('72')).toBeVisible();
      for (const label of ['Critical', 'Serious', 'Moderate', 'Minor']) {
        expect(screen.getByText(label)).toBeVisible();
      }
    });

    it('shows every count, including the zeroes', () => {
      render(
        <AuditResult
          audit={audit({
            countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
          })}
        />,
        {wrapper: Providers},
      );

      expect(screen.getAllByText('0')).toHaveLength(4);
    });

    it('says so rather than showing nothing when there is no score', () => {
      render(<AuditResult audit={audit({score: null})} />, {wrapper: Providers});

      expect(screen.getByText('Not scored')).toBeVisible();
    });

    it('pairs each count with its label programmatically', () => {
      render(<AuditResult audit={audit()} />, {wrapper: Providers});

      const term = screen.getByText('Critical');
      expect(term.tagName).toBe('DT');
      expect(term.nextElementSibling?.textContent).toBe('4');
    });
  });

  describe('an unsettled page', () => {
    it('says the results are provisional', () => {
      render(<AuditResult audit={audit({settled: false})} />, {wrapper: Providers});

      expect(screen.getByRole('note')).toHaveTextContent(/provisional/);
    });

    it('says nothing extra when the page did settle', () => {
      render(<AuditResult audit={audit({settled: true})} />, {wrapper: Providers});

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
      {wrapper: Providers},
    );

    expect(screen.getByRole('region', {name: 'Violations — 1 total'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /^critical image-alt Images need alt text/})).toBeVisible();
  });

  it('needs nothing but a response, so #23 can render it too', () => {
    expect(() => render(<AuditResult audit={audit()} />, {wrapper: Providers})).not.toThrow();
  });
});
