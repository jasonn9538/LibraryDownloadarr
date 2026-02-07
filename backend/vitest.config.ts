import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: './src',
    globals: true,
    setupFiles: ['./__tests__/helpers/setup.ts'],
    testTimeout: 10000,
    pool: 'forks',
  },
});
