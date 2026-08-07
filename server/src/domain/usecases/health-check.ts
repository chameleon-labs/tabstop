import type {HealthCheckModel} from '../models/health-check.js';

export interface HealthCheck {
  check: () => Promise<HealthCheckModel>;
}
