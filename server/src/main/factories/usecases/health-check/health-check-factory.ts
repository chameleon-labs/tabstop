import type {HealthCheck} from '../../../../domain/usecases/health-check.js';
import {HealthCheckUseCase} from '../../../../data/usecases/health-check/health-check.js';
import {NodeUptimeAdapter} from '../../../../infra/system/node-uptime-adapter.js';
import {PostgresHealthAdapter} from '../../../../infra/db/postgres/health/postgres-health-adapter.js';
import {getDatabase} from '../../../config/database.js';

export const makeHealthCheck = (): HealthCheck => {
  const uptimeProvider = new NodeUptimeAdapter();
  const databaseHealthProvider = new PostgresHealthAdapter(getDatabase());
  return new HealthCheckUseCase(uptimeProvider, databaseHealthProvider);
};
