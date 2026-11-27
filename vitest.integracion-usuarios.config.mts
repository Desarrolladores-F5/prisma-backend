import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/integration/aislamiento-usuarios-internos.test.ts',
      'tests/integration/http-usuarios-internos.test.ts',
      'tests/integration/http-aislamiento-cruzado-usuarios.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/.git/**',
    ],
    setupFiles: ['./tests/setup.ts'],
    maxWorkers: 1,
    fileParallelism: false,
  },
});
