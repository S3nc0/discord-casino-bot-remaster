import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The end-to-end and invariant suites run the real server code from `apps/server`, so they use
// the dependencies installed there (fast-check, socket.io-client, better-sqlite3). Run from the
// repository root:
//
//   pnpm exec vitest run --config tests/vitest.config.ts tests/e2e
//   pnpm exec vitest run --config tests/vitest.config.ts tests/invariants
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const fromServer = createRequire(resolve(root, 'apps/server/package.json'));

export default defineConfig({
  root,
  plugins: [
    {
      // The server imports its SQL migrations as text.
      name: 'sql-as-text',
      transform(code, id) {
        return id.endsWith('.sql')
          ? { code: `export default ${JSON.stringify(code)};`, map: null }
          : null;
      },
    },
  ],
  resolve: {
    alias: [
      { find: /^fast-check$/, replacement: fromServer.resolve('fast-check') },
      { find: /^socket\.io-client$/, replacement: fromServer.resolve('socket.io-client') },
    ],
  },
  test: {
    include: ['tests/e2e/**/*.test.ts', 'tests/invariants/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
