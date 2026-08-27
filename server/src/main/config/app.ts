import express, {type Express} from 'express';
import {env} from './env.js';
import {makeProductionDependencies, type AppDependencies} from './app-dependencies.js';
import {setupErrorHandling, setupMiddlewares} from './middlewares.js';
import {setupRoutes} from './routes.js';

export const setupApp = (dependencies: AppDependencies = makeProductionDependencies()): Express => {
  const app = express();
  app.set('trust proxy', env.trustProxyHops);
  setupMiddlewares(app);
  setupRoutes(app, dependencies);
  setupErrorHandling(app);
  return app;
};
