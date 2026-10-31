import { describe, it, expect, vi, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';

describe('Aislamiento de constancias documentales', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('rechaza un directorio alternativo cuando se utiliza la base principal', async () => {
    vi.stubEnv('DB_NAME', 'Prisma');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv(
      'PRISMA_PDF_TEST_DIR',
      path.join(os.tmpdir(), 'prisma-test-documental')
    );

    const { resolverDirectorioConstancias } =
      await import('../src/utils/pdf');

    expect(() => resolverDirectorioConstancias()).toThrow(
      'Directorio alternativo de constancias no autorizado.'
    );
  });

  it('permite un directorio aislado con la base de pruebas', async () => {
    const directorio = path.join(
      os.tmpdir(),
      'prisma-test-documental'
    );

    vi.stubEnv('DB_NAME', 'prisma_test_documental');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PRISMA_PDF_TEST_DIR', directorio);

    const { resolverDirectorioConstancias } =
      await import('../src/utils/pdf');

    expect(resolverDirectorioConstancias()).toBe(
      path.resolve(directorio)
    );
  });
});

describe('Protección contra enlaces simbólicos', () => {
  it('rechaza una carpeta de pruebas que sea un enlace simbólico', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');

    const raiz = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'prisma-seguridad-enlaces-')
    );

    const destino = path.join(raiz, 'destino');
    const enlace = path.join(raiz, 'enlace');

    try {
      await fsp.mkdir(destino);
      await fsp.symlink(destino, enlace, 'dir');

      expect(fs.lstatSync(enlace).isSymbolicLink()).toBe(true);

      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('DB_NAME', 'prisma_test_documental');
      vi.stubEnv('PRISMA_PDF_TEST_DIR', enlace);

      const { resolverDirectorioConstancias } =
        await import('../src/utils/pdf');

      expect(() => resolverDirectorioConstancias()).toThrow();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      await fsp.rm(raiz, { recursive: true, force: true });
    }
  });
});
