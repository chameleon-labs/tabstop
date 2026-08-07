import {describe, expect, it, vi} from 'vitest';
import {makeProductionDependencies} from './app-dependencies.js';

const fakes = vi.hoisted(() => ({
  rateLimiter: {consume: vi.fn()},
  auditQueue: {
    enqueueOnce: vi.fn(),
    has: vi.fn(),
    isPending: vi.fn(),
    backlogCount: vi.fn(),
  },
}));

vi.mock('../factories/middlewares/rate-limit-factory.js', () => ({
  makeRateLimiter: () => fakes.rateLimiter,
}));
vi.mock('../factories/queue/audit-queue.js', () => ({
  getAuditQueue: () => fakes.auditQueue,
}));

describe('makeProductionDependencies', () => {
  it('uses the production limiter and audit queue factories', () => {
    expect(makeProductionDependencies()).toEqual({
      rateLimiter: fakes.rateLimiter,
      auditQueue: fakes.auditQueue,
    });
  });
});
