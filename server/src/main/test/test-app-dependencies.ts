import type { AppDependencies } from '../config/app-dependencies.js'
import { MemoryTokenBucket } from '../../infra/rate-limit/memory-token-bucket.js'
import { TestAuditJobQueue } from './test-audit-job-queue.js'

export type TestAppDependencies = AppDependencies & {
  auditQueue: TestAuditJobQueue
}

export const makeTestAppDependencies = (): TestAppDependencies => ({
  rateLimiter: new MemoryTokenBucket(),
  auditQueue: new TestAuditJobQueue()
})
