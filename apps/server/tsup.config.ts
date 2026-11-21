import { defineConfig } from 'tsup';

// One ESM bundle (dist/main.js). Workspace packages are inlined; npm dependencies stay
// external and are installed next to the bundle (better-sqlite3 ships prebuilt binaries).
export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  dts: false,
  noExternal: [/^@casino\//],
  loader: { '.sql': 'text' },
});
