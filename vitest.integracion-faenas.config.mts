import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/integration/http-faenas-multiempresa.test.ts',
      'tests/integration/http-creacion-faenas-multiempresa.test.ts',
      'tests/integration/http-actualizacion-faenas-multiempresa.test.ts',
      'tests/integration/http-desactivacion-faenas-multiempresa.test.ts',
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
