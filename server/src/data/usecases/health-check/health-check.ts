import type {HealthCheck} from '../../../domain/usecases/health-check.js';
import type {HealthCheckModel} from '../../../domain/models/health-check.js';
import type {UptimeProvider} from '../../protocols/system/uptime-provider.js';
import type {DatabaseHealthProvider} from '../../protocols/db/database-health-provider.js';

export class HealthCheckUseCase implements HealthCheck {
  constructor(
    private readonly uptimeProvider: UptimeProvider,
    private readonly databaseHealthProvider: DatabaseHealthProvider,
  ) {}

  async check(): Promise<HealthCheckModel> {
    const databaseReachable = await this.databaseHealthProvider.isReachable();

    return {
      status: databaseReachable ? 'up' : 'degraded',
      uptimeInSeconds: this.uptimeProvider.getUptimeInSeconds(),
      database: databaseReachable ? 'up' : 'down',
      checkedAt: new Date().toISOString(),
    };
  }
}
