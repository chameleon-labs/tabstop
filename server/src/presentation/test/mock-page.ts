import {vi} from 'vitest';
import type {AuditModel} from '../../domain/models/audit.js';
import type {PageModel, PageSummary} from '../../domain/models/page.js';
import type {AddPage} from '../../domain/usecases/add-page.js';
import type {DeletePage} from '../../domain/usecases/delete-page.js';
import type {LoadPageHistory, PageHistory} from '../../domain/usecases/load-page-history.js';
import type {LoadPages} from '../../domain/usecases/load-pages.js';
import type {UpdatePage} from '../../domain/usecases/update-page.js';

export const mockPageModel = (): PageModel => ({
  id: 'any-page-id',
  siteId: 'any-site-id',
  url: 'https://example.test/pricing',
  monitoringEnabled: true,
  createdAt: new Date('2026-07-29T10:00:00Z'),
});

export const mockLatestAudit = (): AuditModel => ({
  id: 'any-audit-id',
  publicUuid: '22222222-2222-2222-2222-222222222222',
  pageId: 'any-page-id',
  url: 'https://example.test/pricing',
  status: 'done',
  score: 74,
  countsByImpact: {minor: 1, moderate: 2, serious: 0, critical: 1},
  axeVersion: '4.12.1',
  durationMs: 1200,
  error: null,
  createdAt: new Date('2026-07-29T09:00:00Z'),
  completedAt: new Date('2026-07-29T09:00:30Z'),
  settled: true,
});

export const mockPageSummary = (): PageSummary => ({
  page: mockPageModel(),
  domain: 'example.test',
  latestAudit: mockLatestAudit(),
  history: [
    {score: 86, at: new Date('2026-07-27T09:00:00Z')},
    {score: 74, at: new Date('2026-07-29T09:00:00Z')},
  ],
});

export const mockAddPage = () => ({
  add: vi.fn<AddPage['add']>(() =>
    Promise.resolve({
      outcome: 'added' as const,
      page: mockPageModel(),
      firstAuditId: '22222222-2222-2222-2222-222222222222',
    }),
  ),
});

export const mockLoadPages = () => ({
  load: vi.fn<LoadPages['load']>(() => Promise.resolve({pages: [mockPageSummary()], limit: 10})),
});

export const mockUpdatePage = () => ({
  update: vi.fn<UpdatePage['update']>(({monitoringEnabled}) =>
    Promise.resolve({...mockPageModel(), monitoringEnabled}),
  ),
});

export const mockDeletePage = () => ({
  delete: vi.fn<DeletePage['delete']>(() => Promise.resolve(true)),
});

export const mockPageHistory = (): PageHistory => ({
  page: mockPageModel(),
  audits: [
    {
      ...mockLatestAudit(),
      publicUuid: '33333333-3333-3333-3333-333333333333',
      status: 'done',
      score: 86,
      createdAt: new Date('2026-07-27T09:00:00Z'),
      completedAt: new Date('2026-07-27T09:00:30Z'),
    },
    // The middle of a chart is where a failed run has to survive as a point.
    {
      ...mockLatestAudit(),
      publicUuid: '44444444-4444-4444-4444-444444444444',
      status: 'failed',
      score: null,
      axeVersion: null,
      error: 'Navigation timed out',
      completedAt: new Date('2026-07-28T09:00:20Z'),
      createdAt: new Date('2026-07-28T09:00:00Z'),
    },
    mockLatestAudit(),
  ],
});

export const mockLoadPageHistory = () => ({
  load: vi.fn<LoadPageHistory['load']>(() => Promise.resolve(mockPageHistory())),
});
