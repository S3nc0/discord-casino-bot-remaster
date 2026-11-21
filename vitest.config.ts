import { defineConfig } from 'vitest/config';

// `pnpm vitest` at the root runs every package; `pnpm -r test` runs them one by one.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
  },
});
