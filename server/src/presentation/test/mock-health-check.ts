import { vi } from 'vitest'
import type { HealthCheck } from '../../domain/usecases/health-check.js'
import type { HealthCheckModel } from '../../domain/models/health-check.js'

export const mockHealthCheckModel = (): HealthCheckModel => ({
  status: 'up',
  uptimeInSeconds: 42,
  checkedAt: new Date().toISOString()
})

export const mockHealthCheck = (): HealthCheck => ({
  check: vi.fn().mockResolvedValue(mockHealthCheckModel())
})
