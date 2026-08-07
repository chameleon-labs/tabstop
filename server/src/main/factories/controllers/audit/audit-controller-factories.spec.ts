import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {AuditModel} from '../../../../domain/models/audit.js';
import type {AuditJobQueue} from '../../../../data/protocols/queue/audit-job-queue.js';
import {makeRequestAuditController} from './audit-controller-factories.js';

const fakes = vi.hoisted(() => ({
  database: {},
  audits: {
    add: vi.fn(),
    deleteIfQueued: vi.fn(),
  },
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
vi.mock('../../../../infra/db/postgres/audit/postgres-audit-repository.js', () => ({
  PostgresAuditRepository: class {
    add = fakes.audits.add;
    deleteIfQueued = fakes.audits.deleteIfQueued;
  },
}));
vi.mock('../../queue/audit-queue.js', () => ({
  getAuditQueue: () => fakes.globalQueue,
}));

const audit = (): AuditModel => ({
  id: 'audit-1',
  publicUuid: '11111111-1111-1111-1111-111111111111',
  pageId: null,
  url: 'http://93.184.216.34/',
  status: 'queued',
  score: null,
  countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
  axeVersion: null,
  durationMs: null,
  error: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  completedAt: null,
  settled: true,
});

const queue = (): AuditJobQueue => ({
  enqueueOnce: vi.fn<AuditJobQueue['enqueueOnce']>(async () => undefined),
  has: vi.fn<AuditJobQueue['has']>(async () => false),
  isPending: vi.fn<AuditJobQueue['isPending']>(async () => false),
  backlogCount: vi.fn<AuditJobQueue['backlogCount']>(async () => 0),
});

describe('makeRequestAuditController', () => {
  beforeEach(() => {
    fakes.audits.add.mockResolvedValue(audit());
    fakes.audits.deleteIfQueued.mockResolvedValue(undefined);
    fakes.globalQueue.enqueueOnce.mockResolvedValue(undefined);
    fakes.globalQueue.has.mockResolvedValue(false);
    fakes.globalQueue.isPending.mockResolvedValue(false);
    fakes.globalQueue.backlogCount.mockResolvedValue(0);
  });

  it('enqueues through the exact queue supplied to the HTTP factory', async () => {
    const auditQueue = queue();

    const response = await makeRequestAuditController(auditQueue).handle({url: 'http://93.184.216.34/'});

    expect(response.statusCode).toBe(202);
    expect(auditQueue.backlogCount).toHaveBeenCalledOnce();
    expect(auditQueue.enqueueOnce).toHaveBeenCalledWith({auditId: 'audit-1'});
    expect(fakes.globalQueue.enqueueOnce).not.toHaveBeenCalled();
  });
});
