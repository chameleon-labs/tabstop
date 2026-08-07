import type {Router} from 'express';
import {adaptRoute} from '../adapters/express-route-adapter.js';
import {makeHealthCheckController} from '../factories/controllers/health-check/health-check-controller-factory.js';

export const setupHealthCheckRoutes = (router: Router): void => {
  router.get('/health', adaptRoute(makeHealthCheckController()));
};
