import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  unlink: vi.fn(),
}));

vi.mock('../src/models', () => ({
  sequelize: { transaction: vi.fn() },
  RelDocumentoUsuario: { findOne: vi.fn() },
  FirmaDigital: { create: vi.fn() },
  Documento: {},
  Usuario: {},
}));

vi.mock('../src/utils/pdf', () => ({
  generarPDFConfirmacion: vi.fn(),
  resolverDirectorioConstancias: vi.fn(),
}));

import { sequelize, RelDocumentoUsuario, FirmaDigital } from '../src/models';
import {
  generarPDFConfirmacion,
  resolverDirectorioConstancias,
} from '../src/utils/pdf';
import { confirmarRecepcionDocumental } from '../src/services/recepcionDocumental.service';

describe('Limpieza aislada de constancias documentales', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('limpia la constancia fallida desde el directorio autorizado', async () => {
    const directorioAislado = path.resolve(
      '/tmp/prisma-test-documental'
    );

    vi.mocked(resolverDirectorioConstancias)
      .mockReturnValue(directorioAislado);

    const transaccion = {
      commit: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined),
      LOCK: { UPDATE: 'UPDATE' },
    };

    vi.mocked(sequelize.transaction)
      .mockResolvedValueOnce(transaccion as any);

    vi.mocked(RelDocumentoUsuario.findOne)
      .mockResolvedValueOnce({
        id: 8,
        documento_id: 45,
        usuario_id: 12,
        recepcionado: false,
        documento: {
          nombre: 'Procedimiento de prueba',
          tipo: 'Seguridad',
          version: '1.0',
        },
        usuario: {
          nombre: 'Trabajador',
          apellido: 'Prueba',
          correo: 'prueba@example.test',
        },
        save: vi.fn().mockResolvedValue(undefined),
      } as any);

    const nombreArchivo =
      'confirmacion_doc_45_usuario_12_1793390000000_a1b2c3d4-5678-4abc-8def-123456789abc.pdf';

    vi.mocked(generarPDFConfirmacion)
      .mockResolvedValueOnce(
        `/uploads/confirmaciones/${nombreArchivo}`
      );

    vi.mocked(FirmaDigital.create)
      .mockRejectedValueOnce(
        new Error('Error simulado al registrar firma')
      );

    await expect(
      confirmarRecepcionDocumental({
        documentoId: 45,
        usuarioId: 12,
        aceptaDeclaracion: true,
      })
    ).rejects.toThrow('Error simulado al registrar firma');

    expect(transaccion.rollback).toHaveBeenCalledOnce();

    expect(resolverDirectorioConstancias)
      .toHaveBeenCalledOnce();

    expect(fs.unlink).toHaveBeenCalledExactlyOnceWith(
      path.join(directorioAislado, nombreArchivo)
    );
  });
});
