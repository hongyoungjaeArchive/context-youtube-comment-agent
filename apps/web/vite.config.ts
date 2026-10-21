import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const API_TARGET = 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@context/shared': path.resolve(here, '../../packages/shared/src/index.ts') },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      '/__fixture': { target: API_TARGET, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
