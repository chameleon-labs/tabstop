import { vi } from 'vitest'
import type { UptimeProvider } from '../protocols/system/uptime-provider.js'

export const mockUptimeProvider = (): UptimeProvider => ({
  getUptimeInSeconds: vi.fn().mockReturnValue(123)
})
