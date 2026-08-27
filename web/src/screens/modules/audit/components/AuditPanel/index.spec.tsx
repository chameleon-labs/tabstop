import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {MemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {AuditResultResponse} from '@tabstop/contract';
import {jsonResponse} from '@/test/http';
import {exactTime} from '../../page-time';
import {AuditPanel} from './index';

const AUDIT: AuditResultResponse = {
  auditId: '11111111-1111-1111-1111-111111111111',
  url: 'https://acme.example/checkout',
  status: 'done',
  createdAt: '2026-08-15T10:00:00.000Z',
  completedAt: '2026-08-15T10:00:30.000Z',
  score: 74,
  countsByImpact: {minor: 1, moderate: 2, serious: 0, critical: 1},
  axeVersion: '4.12.1',
  settled: true,
  error: null,
  violations: [
    {
      ruleId: 'color-contrast',
      impact: 'serious',
      description: 'Elements must have sufficient colour contrast',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/color-contrast',
      nodes: [{target: ['.cta'], html: '<a class="cta">Buy</a>'}],
    },
  ],
};

const OTHER_AUDIT: AuditResultResponse = {
  ...AUDIT,
  auditId: '22222222-2222-2222-2222-222222222222',
  createdAt: '2026-08-14T10:00:00.000Z',
  violations: [
    {
      ruleId: 'image-alt',
      impact: 'critical',
      description: 'Images must have alternate text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
      nodes: [{target: ['img'], html: '<img src="a.png">'}],
    },
  ],
};

const FAILED_AUDIT: AuditResultResponse = {
  ...AUDIT,
  status: 'failed',
  score: null,
  countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
  completedAt: null,
  error: 'Navigation timed out after 30 seconds',
  violations: [],
};

let fetchMock: ReturnType<typeof vi.fn>;

const Harness = ({children}: {children: React.ReactNode}): React.JSX.Element => {
  const [client] = useState(() => new QueryClient({defaultOptions: {queries: {retry: false}}}));

  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
};

const renderPanel = (
  auditId = AUDIT.auditId,
  onClose = vi.fn(),
): {onClose: ReturnType<typeof vi.fn>; rerender: (auditId: string) => void} => {
  const view = render(<AuditPanel auditId={auditId} onClose={onClose} />, {wrapper: Harness});

  return {
    onClose,
    rerender: (next: string): void => {
      view.rerender(<AuditPanel auditId={next} onClose={onClose} />);
    },
  };
};

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, AUDIT)));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuditPanel', () => {
  it('is present and marked busy while the result is still coming', () => {
    fetchMock.mockImplementation(() => Promise.withResolvers<Response>().promise);
    renderPanel();

    const panel = screen.getByRole('region', {name: /audit result/i});
    expect(panel).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(new RegExp(AUDIT.auditId))).toBeVisible();
  });

  it('renders the result it fetched, not a placeholder for one', async () => {
    renderPanel();

    expect(await screen.findByText('Elements must have sufficient colour contrast')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/audits/${AUDIT.auditId}`,
      expect.objectContaining({credentials: 'include'}),
    );
  });

  it('names the audit it is showing, by when it ran', async () => {
    renderPanel();

    expect(await screen.findByRole('heading', {name: `Audit on ${exactTime(AUDIT.createdAt)}`})).toBeVisible();
  });

  it('quotes the failure rather than scoring a failed run zero', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, FAILED_AUDIT)));
    renderPanel();

    expect(await screen.findByText('Navigation timed out after 30 seconds')).toBeVisible();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it.each(['queued', 'running'] as const)(
    'waits for a %s audit rather than reporting it as a result',
    async (status) => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          jsonResponse(200, {...AUDIT, status, score: null, completedAt: null, settled: false, violations: []}),
        ),
      );
      renderPanel();

      expect(await screen.findByText(new RegExp(`still ${status}`, 'i'))).toBeVisible();
      expect(screen.getByRole('region', {name: /audit on/i})).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByText('Not scored')).not.toBeInTheDocument();
      expect(screen.queryByText('Violations — 0 total')).not.toBeInTheDocument();
    },
  );

  it('stops promising a result once the poll behind it has died', async () => {
    let answered = false;
    fetchMock.mockImplementation(() => {
      if (answered) {
        return Promise.resolve(jsonResponse(500, {error: 'Server error'}));
      }
      answered = true;
      return Promise.resolve(
        jsonResponse(200, {...AUDIT, status: 'running', score: null, completedAt: null, violations: []}),
      );
    });
    renderPanel();
    await screen.findByText(/still running/i);

    expect(await screen.findByText('Server error', undefined, {timeout: 4000})).toBeVisible();
    expect(screen.queryByText(/will appear here/i)).not.toBeInTheDocument();
    expect(screen.getByRole('region', {name: /audit on/i})).toHaveAttribute('aria-busy', 'false');
  });

  it('offers the retry that the dead poll no longer performs', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Server error'})));
    renderPanel();
    const user = userEvent.setup();
    await screen.findByText('Server error');
    const before = fetchMock.mock.calls.length;

    await user.click(screen.getByRole('button', {name: 'Retry'}));

    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });

  it('offers no retry for a result that is gone for good', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(404, {error: 'Audit not found'})));
    renderPanel();

    await screen.findByText(/no longer available/i);

    expect(screen.queryByRole('button', {name: 'Retry'})).not.toBeInTheDocument();
  });

  it('says a missing result is gone, and stays closable', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(404, {error: 'Audit not found'})));
    const {onClose} = renderPanel();
    const user = userEvent.setup();

    expect(await screen.findByText(/no longer available/i)).toBeVisible();

    await user.click(screen.getByRole('button', {name: /close/i}));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when asked', async () => {
    const {onClose} = renderPanel();
    const user = userEvent.setup();
    await screen.findByText('Elements must have sufficient colour contrast');

    await user.click(screen.getByRole('button', {name: /close/i}));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('drops the old result when it is pointed at another audit', async () => {
    const {rerender} = renderPanel();
    await screen.findByText('Elements must have sufficient colour contrast');

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, OTHER_AUDIT)));
    rerender(OTHER_AUDIT.auditId);

    expect(screen.queryByText('Elements must have sufficient colour contrast')).not.toBeInTheDocument();
    expect(await screen.findByText('Images must have alternate text')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(`/api/audits/${OTHER_AUDIT.auditId}`, expect.anything());
  });
});
