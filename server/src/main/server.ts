import {setupApp} from './config/app.js';
import {env} from './config/env.js';
import {connectDatabase, disconnectDatabase, getDatabase} from './config/database.js';
import {closeRateLimiter} from './factories/middlewares/rate-limit-factory.js';
import {startListening} from './config/listen.js';
import {PostgresHealthAdapter} from '../infra/db/postgres/health/postgres-health-adapter.js';

connectDatabase(env.databaseUrl);

const app = setupApp();

const server = startListening(app, env.port, {
  info: (message) => {
    console.log(message);
  },
  fatal: (message) => {
    console.error(message);
    process.exit(1);
  },
});

void new PostgresHealthAdapter(getDatabase()).isReachable().then((reachable) => {
  console.log(
    reachable
      ? 'Database connection established'
      : 'Database unreachable - serving in degraded state, /api/health will report 503',
  );
});

const shutdown = (signal: string): void => {
  console.log(`${signal} received, shutting down`);

  const forceExit = setTimeout(() => {
    console.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(() => {
    void Promise.all([disconnectDatabase(), closeRateLimiter()])
      .then(() => {
        process.exit(0);
      })
      .catch((error: unknown) => {
        console.error('Error closing the database pool or rate limiter:', error);
        process.exit(1);
      });
  });
  server.closeIdleConnections();
};

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
