import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {AuditModel} from '../../../../domain/models/audit.js';
import type {PageModel} from '../../../../domain/models/page.js';
import type {AuditJobQueue} from '../../../../data/protocols/queue/audit-job-queue.js';
import {makeAddPageController} from './page-controller-factories.js';

const fakes = vi.hoisted(() => ({
  database: {},
  pages: {add: vi.fn()},
  audits: {deleteIfQueued: vi.fn()},
  globalQueue: {
    enqueueOnce: vi.fn(),
    has: vi.fn(),
    isPending: vi.fn(),
    backlogCount: vi.fn(),
  },
}));

vi.mock('../../../config/database.js', () => ({
  getDatabase: () => fakes.database,
}));
vi.mock('../../../../infra/db/postgres/page/postgres-page-repository.js', () => ({
  PostgresPageRepository: class {
    add = fakes.pages.add;
  },
}));
vi.mock('../../../../infra/db/postgres/audit/postgres-audit-repository.js', () => ({
  PostgresAuditRepository: class {
    deleteIfQueued = fakes.audits.deleteIfQueued;
  },
}));
vi.mock('../../queue/audit-queue.js', () => ({
  getAuditQueue: () => fakes.globalQueue,
}));

const page = (): PageModel => ({
  id: 'page-1',
  siteId: 'site-1',
  url: 'http://93.184.216.34/',
  monitoringEnabled: true,
  createdAt: new Date('2026-08-01T00:00:00Z'),
});

const firstAudit = (): AuditModel => ({
  id: 'audit-1',
  publicUuid: '11111111-1111-1111-1111-111111111111',
  pageId: 'page-1',
  url: 'http://93.184.216.34/',
  status: 'queued',
  score: null,
  countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
  axeVersion: null,
  durationMs: null,
  error: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  completedAt: null,
  scheduledFor: null,
  settled: true,
});

const queue = (): AuditJobQueue => ({
  enqueueOnce: vi.fn<AuditJobQueue['enqueueOnce']>(() => Promise.resolve(undefined)),
  has: vi.fn<AuditJobQueue['has']>(() => Promise.resolve(false)),
  isPending: vi.fn<AuditJobQueue['isPending']>(() => Promise.resolve(false)),
  backlogCount: vi.fn<AuditJobQueue['backlogCount']>(() => Promise.resolve(0)),
});

describe('makeAddPageController', () => {
  beforeEach(() => {
    fakes.pages.add.mockResolvedValue({outcome: 'added', page: page(), firstAudit: firstAudit()});
    fakes.audits.deleteIfQueued.mockResolvedValue(undefined);
    fakes.globalQueue.enqueueOnce.mockResolvedValue(undefined);
    fakes.globalQueue.has.mockResolvedValue(false);
    fakes.globalQueue.isPending.mockResolvedValue(false);
    fakes.globalQueue.backlogCount.mockResolvedValue(0);
  });

  it('enqueues through the exact queue supplied to the HTTP factory', async () => {
    const auditQueue = queue();

    const response = await makeAddPageController(auditQueue).handle({
      userId: 'user-1',
      url: 'http://93.184.216.34/',
    });

    expect(response.statusCode).toBe(201);
    expect(auditQueue.enqueueOnce).toHaveBeenCalledWith({auditId: 'audit-1'});
    expect(fakes.globalQueue.enqueueOnce).not.toHaveBeenCalled();
  });
});
