import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@context/shared': path.resolve(import.meta.dirname, 'packages/shared/src/index.ts') },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/server/src/**/*.test.ts', 'apps/web/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['packages/shared/src/**', 'apps/server/src/**'],
      exclude: ['**/*.test.ts', 'apps/server/src/index.ts', 'apps/server/src/fixtures/**'],
      reporter: ['text-summary', 'text'],
    },
  },
});
