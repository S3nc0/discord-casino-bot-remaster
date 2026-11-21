import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Inside Discord the Activity is served from the proxy root `/` and the API from `/api`.
// Everything (fonts included) must be bundled; the iframe can only reach mapped URLs.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', ws: true },
      // Avatars: in Discord the Developer Portal maps `/cdn` to the Discord CDN host.
      '/cdn': {
        target: 'https://cdn.discordapp.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cdn/, ''),
      },
    },
  },
});
