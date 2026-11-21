import { defineConfig } from 'vitest/config';

export default defineConfig({
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
  test: {
    include: ['src/**/*.test.ts'],
  },
});
