import type {Express} from 'express';
import type {Server} from 'node:http';

export type ListenHandlers = {
  info: (message: string) => void;
  fatal: (message: string) => void;
};

const boundPort = (server: Server): number | null => {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    return null;
  }
  return address.port;
};

export const startListening = (app: Express, port: number, handlers: ListenHandlers): Server => {
  const server = app.listen(port, () => {
    const bound = boundPort(server);
    if (bound !== null) {
      handlers.info(`Server running at http://localhost:${bound}`);
    }
  });

  server.once('error', (error: NodeJS.ErrnoException) => {
    handlers.fatal(
      error.code === 'EADDRINUSE'
        ? `Port ${port} is already in use (EADDRINUSE) - stop whatever holds it, or set PORT`
        : `Server failed to listen on port ${port}: ${error.message}`,
    );
  });

  return server;
};
