import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/.git/**',
      'tests/integration/**',
    ],
    setupFiles: ['./tests/setup.ts'],
  },
});
