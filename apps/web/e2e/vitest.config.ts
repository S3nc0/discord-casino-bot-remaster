import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Browser tests: `pnpm --filter @casino/web e2e`. They start a real server from `apps/server`
// (imported as source) and drive Chrome through playwright-core.
const here = dirname(fileURLToPath(import.meta.url));
const fromServer = createRequire(resolve(here, '../../server/package.json'));

export default defineConfig({
  root: resolve(here, '..'),
  plugins: [
    {
      name: 'sql-as-text',
      transform(code, id) {
        return id.endsWith('.sql')
          ? { code: `export default ${JSON.stringify(code)};`, map: null }
          : null;
      },
    },
  ],
  resolve: {
    alias: [{ find: /^typebox$/, replacement: fromServer.resolve('typebox') }],
  },
  test: {
    include: ['e2e/**/*.e2e.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One browser, one server: the files run one after another.
    fileParallelism: false,
  },
});
