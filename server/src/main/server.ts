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
  // Exit rather than log and continue. A process that stays alive holding no
  // socket is the failure this replaces: the log claimed it was serving, and
  // nothing - supervisor or `concurrently --kill-others` - saw an exit to
  // react to. See #84.
  fatal: (message) => {
    console.error(message);
    process.exit(1);
  },
});

// The reachability probe is purely informational - a log line - so it must
// never gate the listener. An unreachable database degrades the service
// (503 from /api/health) rather than blocking boot.
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
        // Exit non-zero so a supervisor or CI can distinguish a failed teardown
        // from a clean one - matching the force-exit path above.
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
