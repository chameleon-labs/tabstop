import type {Controller} from '../../protocols/controller.js';
import type {HealthCheck} from '../../../domain/usecases/health-check.js';
import {ok, serverError, serviceUnavailable} from '../../helpers/http/http-helper.js';
import type {HttpResponse} from '../../protocols/http.js';

export class HealthCheckController implements Controller {
  constructor(private readonly healthCheck: HealthCheck) {}

  async handle(): Promise<HttpResponse> {
    try {
      const result = await this.healthCheck.check();
      return result.status === 'up' ? ok(result) : serviceUnavailable(result);
    } catch (error) {
      return serverError(error as Error);
    }
  }
}
