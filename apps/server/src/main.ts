import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ConfigError, loadConfig } from './runtime/config.ts';
import { createServer } from './runtime/server.ts';

// Entry point of the single server process. The chat bot and the scheduler plug into the
// services returned by `createServer`; this file only validates the environment, starts HTTP and
// sockets, and shuts down cleanly.
async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  if (config.databasePath !== ':memory:')
    mkdirSync(dirname(config.databasePath), { recursive: true });
  // Bound to loopback by default and reached through the tunnel, so forwarded headers are
  // trusted for the client address (rate limits).
  const server = createServer({ config, trustProxy: true });
  const address = await server.listen();
  server.logger.info({ address, env: config.nodeEnv }, 'casino server listening');

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    server.logger.info({ signal }, 'shutting down');
    server
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        server.logger.error({ err: error }, 'shutdown failed');
        process.exit(1);
      });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
