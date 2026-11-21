import { migrations } from './db/migrations/index.ts';

// Entry point of the single server process. Fastify, Socket.io, the chat bot and the
// scheduler are wired here by the server-core task; the skeleton only proves the bundle runs.
export function main(): void {
  console.log(`casino server skeleton: ${migrations.length} migration(s) bundled`);
}

main();
