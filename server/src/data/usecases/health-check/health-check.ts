import type { HealthCheck } from '../../../domain/usecases/health-check.js'
import type { HealthCheckModel } from '../../../domain/models/health-check.js'
import type { UptimeProvider } from '../../protocols/system/uptime-provider.js'

export class HealthCheckUseCase implements HealthCheck {
  constructor (private readonly uptimeProvider: UptimeProvider) {}

  async check (): Promise<HealthCheckModel> {
    return {
      status: 'up',
      uptimeInSeconds: this.uptimeProvider.getUptimeInSeconds(),
      checkedAt: new Date().toISOString()
    }
  }
}
