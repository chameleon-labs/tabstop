import express, {type Express} from 'express';
import {
  cors,
  contentType,
  errorHandler,
  noStore,
  notFoundHandler,
  sameOrigin,
  securityHeaders,
} from '../middlewares/index.js';

export const setupMiddlewares = (app: Express): void => {
  app.disable('x-powered-by');

  app.use(cors);
  app.use(noStore);
  app.use(securityHeaders);
  app.use(sameOrigin);
  app.use(express.urlencoded({extended: false, limit: '10kb', parameterLimit: 10}));
  app.use(express.json());
  app.use(contentType);
};

export const setupErrorHandling = (app: Express): void => {
  app.use(notFoundHandler);
  app.use(errorHandler);
};
