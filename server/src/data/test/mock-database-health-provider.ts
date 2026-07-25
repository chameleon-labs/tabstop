import { vi } from 'vitest'
import type { DatabaseHealthProvider } from '../protocols/db/database-health-provider.js'

export const mockDatabaseHealthProvider = (): DatabaseHealthProvider => ({
  isReachable: vi.fn().mockResolvedValue(true)
})
