import type {Controller} from '../../../../presentation/protocols/controller.js';
import {HealthCheckController} from '../../../../presentation/controllers/health-check/health-check-controller.js';
import {makeHealthCheck} from '../../usecases/health-check/health-check-factory.js';

export const makeHealthCheckController = (): Controller => {
  return new HealthCheckController(makeHealthCheck());
};
