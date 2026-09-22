import { defineConfig } from 'vitest/config';

// Integration tests against a real Supabase (local `supabase start` in CI, or
// a dev project). Each file builds its own throwaway tenant and purges it.
export default defineConfig({
  test: {
    name: 'db-tests',
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
