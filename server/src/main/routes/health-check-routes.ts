import type {Router} from 'express';
import {adaptRoute} from '../adapters/express-route-adapter.js';
import {makeHealthCheckController} from '../factories/controllers/health-check/health-check-controller-factory.js';

export default (router: Router): void => {
  router.get('/health', adaptRoute(makeHealthCheckController()));
};
