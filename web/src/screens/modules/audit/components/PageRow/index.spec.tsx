import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {AuditStatus, LatestPageAudit, PageScorePoint, PageSummary} from '@tabstop/contract';
import {jsonResponse} from '@/test/http';
import {Providers} from '@/test/render';
import {PageRow} from './index';

const NOW = Date.parse('2026-08-15T12:00:00.000Z');
const URL = 'https://example.test/checkout';

const HISTORY: PageScorePoint[] = [
  {score: 82, at: '2026-08-14T10:00:00.000Z'},
  {score: 74, at: '2026-08-15T10:00:00.000Z'},
];

const audit = (status: AuditStatus, score: number | null = 74): LatestPageAudit => ({
  auditId: 'audit-1',
  status,
  score,
  countsByImpact: {minor: 1, moderate: 0, serious: 0, critical: 1},
  createdAt: '2026-08-15T11:42:00.000Z',
  completedAt: status === 'done' || status === 'failed' ? '2026-08-15T11:42:30.000Z' : null,
  error: status === 'failed' ? 'Navigation timeout' : null,
});

type Patch = {
  monitoringEnabled?: boolean;
  latestAudit?: LatestPageAudit | null;
  history?: PageScorePoint[];
  nextAuditAt?: string | null;
};

const page = (patch: Patch = {}): PageSummary => {
  const {monitoringEnabled = true, latestAudit = audit('done'), history = HISTORY, nextAuditAt = null} = patch;

  return {
    id: 'page-1',
    url: URL,
    monitoringEnabled,
    createdAt: '2026-08-01T09:00:00.000Z',
    domain: 'example.test',
    latestAudit,
    score: history.at(-1)?.score ?? null,
    previousScore: history.at(-2)?.score ?? null,
    history,
    nextAuditAt,
  };
};

const renderRow = (summary: PageSummary = page(), overrides: Partial<{onToast: () => void}> = {}) => {
  const onToast = vi.fn();
  const onRequestRemove = vi.fn();

  const result = render(
    <Providers>
      <ul>
        <PageRow page={summary} now={NOW} onToast={overrides.onToast ?? onToast} onRequestRemove={onRequestRemove} />
      </ul>
    </Providers>,
  );

  return {...result, onToast: overrides.onToast ?? onToast, onRequestRemove};
};

const row = (): HTMLElement => screen.getByRole('listitem');

const scoreText = (): string | undefined => row().querySelector('.page-row__score')?.textContent ?? undefined;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve(jsonResponse(200, {id: 'page-1', url: URL, monitoringEnabled: false, createdAt: 'x'})),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PageRow identity', () => {
  it('navigates by the full url, so two pages on one domain stay apart', () => {
    renderRow();

    expect(screen.getByRole('link', {name: `View details for ${URL}`})).toHaveAttribute('href', '/pages/page-1');
  });

  it('shows the domain first and the address under it', () => {
    renderRow();

    expect(screen.getByText('example.test')).toBeVisible();
    expect(screen.getByText(URL)).toBeVisible();
  });

  it('is a list item, not a giant button', () => {
    renderRow();

    expect(row().tagName).toBe('LI');
    expect(row()).not.toHaveAttribute('role', 'button');
    expect(within(row()).queryByRole('button', {name: `View details for ${URL}`})).not.toBeInTheDocument();
  });

  it.each([
    {name: 'pause', monitoringEnabled: true, label: `Pause monitoring for ${URL}`},
    {name: 'resume', monitoringEnabled: false, label: `Resume monitoring for ${URL}`},
  ])('names its $name control after the page it acts on', ({monitoringEnabled, label}) => {
    renderRow(page({monitoringEnabled}));

    expect(screen.getByRole('button', {name: label})).toBeVisible();
    expect(screen.getByRole('button', {name: `Remove ${URL}`})).toBeVisible();
  });
});

describe('PageRow states', () => {
  it('shows a regression as a score, a delta and a trend', () => {
    renderRow();

    expect(row()).toHaveAttribute('data-state', 'scored');
    expect(scoreText()).toBe('Score 74 out of 100');
    expect(screen.getByText('Score down 8 points since the previous audit')).toBeVisible();
    expect(screen.getByRole('img', {name: /Score trend: 82 to 74/})).toBeVisible();
    expect(screen.getByText('Audited 17 minutes ago')).toBeVisible();
  });

  it('shows an improvement with the direction reversed', () => {
    renderRow(
      page({
        history: [
          {score: 74, at: '2026-08-14T10:00:00.000Z'},
          {score: 82, at: '2026-08-15T10:00:00.000Z'},
        ],
      }),
    );

    expect(screen.getByText('Score up 8 points since the previous audit')).toBeVisible();
  });

  it('says a first score is a first score rather than inventing a zero change', () => {
    renderRow(page({history: [{score: 74, at: '2026-08-15T10:00:00.000Z'}]}));

    expect(screen.getByText('First completed score')).toBeVisible();
  });

  it('never renders a failed audit as a score of zero', () => {
    renderRow(page({latestAudit: audit('failed', null)}));

    expect(row()).toHaveAttribute('data-state', 'failed');
    expect(screen.getByText(/Navigation timeout/)).toBeVisible();
    expect(scoreText()).toBe('Last successful score 74 out of 100');
    expect(scoreText()).not.toContain('0 out of 100');
  });

  it('keeps a paused page muted but still readable', () => {
    renderRow(page({monitoringEnabled: false}));

    expect(row()).toHaveAttribute('data-state', 'paused');
    expect(screen.getByText('Paused')).toBeVisible();
    expect(scoreText()).toBe('Last successful score 74 out of 100');
    expect(screen.getByRole('button', {name: `Resume monitoring for ${URL}`})).toBeVisible();
  });

  it('waits for a queued first audit without pretending to measure anything', () => {
    renderRow(page({latestAudit: audit('queued', null), history: []}));

    expect(row()).toHaveAttribute('data-state', 'first-audit');
    expect(screen.getByText(/First audit: Waiting for a free worker/)).toBeVisible();
    expect(scoreText()).toBeUndefined();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows no score at all when a failed page has never had one', () => {
    renderRow(page({latestAudit: audit('failed', null), history: []}));

    expect(row()).toHaveAttribute('data-state', 'failed');
    expect(screen.getByText(/Navigation timeout/)).toBeVisible();
    expect(scoreText()).toBeUndefined();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('narrates a running first audit with the existing phase vocabulary', () => {
    renderRow(page({latestAudit: audit('running', null), history: []}));

    expect(row()).toHaveAttribute('data-state', 'first-audit');
    expect(screen.getByText(/First audit: /)).toBeVisible();
    expect(scoreText()).toBeUndefined();
  });

  it('keeps the last result on screen while a re-audit runs', () => {
    renderRow(page({latestAudit: audit('running', null)}));

    expect(row()).toHaveAttribute('data-state', 'reaudit');
    expect(screen.getByText(/Re-audit: /)).toBeVisible();
    expect(scoreText()).toBe('Score 74 out of 100');
    expect(screen.getByRole('img', {name: /Score trend/})).toBeVisible();
  });

  it('says a first audit could not start rather than that it is running', () => {
    renderRow(page({latestAudit: null, history: []}));

    expect(row()).toHaveAttribute('data-state', 'unstarted');
    expect(screen.getByText(/first audit could not start/i)).toBeVisible();
    expect(screen.queryByText(/Re-audit|First audit: /)).not.toBeInTheDocument();
  });

  it('gives the timestamp an exact value under its relative label', () => {
    renderRow();

    const time = row().querySelector('time')!;
    expect(time).toHaveAttribute('datetime', '2026-08-15T11:42:30.000Z');
    expect(time).toHaveAccessibleName(expect.stringContaining('Audited'));
  });
});

describe('PageRow monitoring', () => {
  it('sends exactly one patch and reports the outcome upward', async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    renderRow(page(), {onToast});

    await user.click(screen.getByRole('button', {name: `Pause monitoring for ${URL}`}));

    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith(expect.objectContaining({variant: 'success'}));
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/pages/page-1',
      expect.objectContaining({method: 'PATCH', body: JSON.stringify({monitoringEnabled: false})}),
    );
    expect(onToast.mock.calls[0]![0].message).toContain(URL);
  });

  it('marks only its own control as working', async () => {
    const user = userEvent.setup();
    let release!: (value: Response) => void;
    fetchMock.mockImplementation(
      async () =>
        await new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    renderRow();

    await user.click(screen.getByRole('button', {name: `Pause monitoring for ${URL}`}));

    await waitFor(() => {
      expect(screen.getByRole('button', {name: /Pausing/})).toBeDisabled();
    });
    expect(screen.getByRole('button', {name: `Remove ${URL}`})).toBeEnabled();

    await act(async () => {
      release(jsonResponse(200, {id: 'page-1', url: URL, monitoringEnabled: false, createdAt: 'x'}));
      await Promise.resolve();
    });
  });

  it('reports a refused change as something that needs attention', async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Server error'})));
    renderRow(page(), {onToast});

    await user.click(screen.getByRole('button', {name: `Pause monitoring for ${URL}`}));

    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith(expect.objectContaining({variant: 'danger'}));
    });
    expect(onToast.mock.calls[0]![0].message).toContain(URL);
  });

  it('hands removal to the screen rather than deleting anything itself', async () => {
    const user = userEvent.setup();
    const {onRequestRemove} = renderRow();

    await user.click(screen.getByRole('button', {name: `Remove ${URL}`}));

    expect(onRequestRemove).toHaveBeenCalledTimes(1);
    const [target, trigger] = onRequestRemove.mock.calls[0]!;
    expect(target).toEqual(page());
    expect(trigger).toBe(screen.getByRole('button', {name: `Remove ${URL}`}));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('PageRow clocks', () => {
  beforeEach(() => {
    vi.useFakeTimers({shouldAdvanceTime: true});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs no clock for a row that has finished', () => {
    renderRow();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs a clock only while an audit is actually in flight', () => {
    renderRow(page({latestAudit: audit('running', null), history: []}));

    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it('stops its clock when the row goes away', () => {
    const {unmount} = renderRow(page({latestAudit: audit('running', null), history: []}));

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('PageRow rendering safety', () => {
  it('renders a hostile failure message as text', async () => {
    renderRow(page({latestAudit: {...audit('failed', null), error: '<img src=x onerror=alert(1)>'}}));

    await act(async () => {
      await Promise.resolve();
    });

    expect(row().querySelector('img')).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeVisible();
  });
});

describe('PageRow schedule', () => {
  it('says when the run will next reach this page', () => {
    renderRow(page({nextAuditAt: '2026-08-16T05:30:00.000Z'}));

    expect(screen.getByText(/Next audit/)).toBeVisible();
  });

  it('says a paused page has none, rather than leaving the line off', () => {
    renderRow(page({monitoringEnabled: false, nextAuditAt: null}));

    expect(screen.getByText('No next audit while paused')).toBeVisible();
  });

  it('promises nothing while an audit is actually running', () => {
    renderRow(page({latestAudit: audit('running'), nextAuditAt: null}));

    expect(screen.queryByText(/Next audit/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No next audit/)).not.toBeInTheDocument();
  });
});
