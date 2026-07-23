import type { HealthCheck } from '../../../../domain/usecases/health-check.js'
import { HealthCheckUseCase } from '../../../../data/usecases/health-check/health-check.js'
import { NodeUptimeAdapter } from '../../../../infra/system/node-uptime-adapter.js'

export const makeHealthCheck = (): HealthCheck => {
  const uptimeProvider = new NodeUptimeAdapter()
  return new HealthCheckUseCase(uptimeProvider)
}
