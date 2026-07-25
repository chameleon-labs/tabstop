import { vi } from 'vitest'
import type { HealthCheck } from '../../domain/usecases/health-check.js'
import type { HealthCheckModel } from '../../domain/models/health-check.js'

export const mockHealthCheckModel = (
  overrides: Partial<HealthCheckModel> = {}
): HealthCheckModel => ({
  status: 'up',
  uptimeInSeconds: 42,
  database: 'up',
  checkedAt: new Date().toISOString(),
  ...overrides
})

export const mockHealthCheck = (): HealthCheck => ({
  check: vi.fn().mockResolvedValue(mockHealthCheckModel())
})
