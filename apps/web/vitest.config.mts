import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { join } from 'node:path';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/web',
  plugins: [react()],
  resolve: {
    alias: {
      '@': join(import.meta.dirname, '.'),
    },
  },
  test: {
    name: '@fxdesk/web',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,app,pages,specs,lib,components}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    }
  },
}));
