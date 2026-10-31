import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  unlink: vi.fn(),
}));

vi.mock('../src/models', () => ({
  sequelize: {
    transaction: vi.fn(),
  },
  RelDocumentoUsuario: {
    findOne: vi.fn(),
  },
  FirmaDigital: {
    create: vi.fn(),
  },
  Documento: {},
  Usuario: {},
}));

vi.mock('../src/services/notificacionesAutomaticas.service', () => ({
  avisarRecepcionDocumental: vi.fn(),
}));

vi.mock('../src/utils/pdf', () => ({
  generarPDFConfirmacion: vi.fn(),
  resolverDirectorioConstancias: vi.fn(
    () => '/tmp/prisma-test-documental'
  ),
}));

import { sequelize, RelDocumentoUsuario, FirmaDigital } from '../src/models';
import { generarPDFConfirmacion } from '../src/utils/pdf';
import { confirmarRecepcionDocumental } from '../src/services/recepcionDocumental.service';
import { avisarRecepcionDocumental } from '../src/services/notificacionesAutomaticas.service';

describe('Servicio unificado de recepción documental', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('registra una recepción válida con constancia y firma digital', async () => {
    const transaccion = {
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      LOCK: { UPDATE: 'UPDATE' },
    };

    vi.mocked(sequelize.transaction).mockResolvedValueOnce(transaccion as any);

    const guardar = vi.fn().mockResolvedValue(undefined);

    vi.mocked(RelDocumentoUsuario.findOne).mockResolvedValueOnce({
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
      save: guardar,
    } as any);

    vi.mocked(generarPDFConfirmacion).mockResolvedValueOnce(
      '/uploads/confirmaciones/confirmacion_doc_45_usuario_12_1234567890.pdf'
    );

    vi.mocked(FirmaDigital.create).mockResolvedValueOnce({
      id: 99,
    } as any);

    const resultado = await confirmarRecepcionDocumental({
      documentoId: 45,
      usuarioId: 12,
      aceptaDeclaracion: true,
    });

    expect(resultado.ruta_constancia_pdf).toBe(
      '/uploads/confirmaciones/confirmacion_doc_45_usuario_12_1234567890.pdf'
    );

    expect(RelDocumentoUsuario.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          documento_id: 45,
          usuario_id: 12,
        },
        transaction: transaccion,
        lock: transaccion.LOCK.UPDATE,
      })
    );

    expect(guardar).toHaveBeenCalledWith({
      transaction: transaccion,
    });

    expect(FirmaDigital.create).toHaveBeenCalledWith(
      expect.objectContaining({
        firmante_id: 12,
        documento_id: 45,
        tipo_firma: 'firma_documento',
      }),
      { transaction: transaccion }
    );

    expect(guardar).toHaveBeenCalledOnce();
    expect(FirmaDigital.create).toHaveBeenCalledOnce();
    expect(transaccion.commit).toHaveBeenCalledOnce();
    expect(transaccion.rollback).not.toHaveBeenCalled();

    expect(avisarRecepcionDocumental).toHaveBeenCalledExactlyOnceWith({
      usuarioId: 12,
      documentoId: 45,
      nombreDocumento: 'Procedimiento de prueba',
    });

    expect(
      vi.mocked(transaccion.commit).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(avisarRecepcionDocumental).mock.invocationCallOrder[0]
    );
  });

  it('revierte la transacción cuando falla el registro de la firma', async () => {
    const transaccion = {
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      LOCK: { UPDATE: 'UPDATE' },
    };

    vi.mocked(sequelize.transaction).mockResolvedValueOnce(transaccion as any);

    const guardar = vi.fn().mockResolvedValue(undefined);

    vi.mocked(RelDocumentoUsuario.findOne).mockResolvedValueOnce({
      id: 8,
      documento_id: 45,
      usuario_id: 12,
      recepcionado: false,
      documento: {
        nombre: 'Procedimiento de prueba',
        tipo: 'Seguridad',
      },
      usuario: {
        nombre: 'Trabajador',
        apellido: 'Prueba',
        correo: 'prueba@example.test',
      },
      save: guardar,
    } as any);

    vi.mocked(generarPDFConfirmacion).mockResolvedValueOnce(
      '/uploads/confirmaciones/confirmacion_doc_45_usuario_12_1234567890.pdf'
    );

    vi.mocked(FirmaDigital.create).mockRejectedValueOnce(
      new Error('Error simulado al guardar firma')
    );

    await expect(
      confirmarRecepcionDocumental({
        documentoId: 45,
        usuarioId: 12,
        aceptaDeclaracion: true,
      })
    ).rejects.toThrow('Error simulado al guardar firma');

    expect(guardar).toHaveBeenCalledOnce();
    expect(FirmaDigital.create).toHaveBeenCalledOnce();
    expect(transaccion.rollback).toHaveBeenCalledOnce();
    expect(transaccion.commit).not.toHaveBeenCalled();

    // Solo se debe limpiar la constancia recién generada.
    expect(fs.unlink).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(
        /[/\\]prisma-test-documental[/\\]confirmacion_doc_45_usuario_12_1234567890\.pdf$/
      )
    );
  });


  it('no elimina archivos fuera de la carpeta de constancias', async () => {
    const transaccion = {
      commit: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined),
      LOCK: { UPDATE: 'UPDATE' },
    };

    vi.mocked(sequelize.transaction).mockResolvedValueOnce(transaccion as any);

    vi.mocked(RelDocumentoUsuario.findOne).mockResolvedValueOnce({
      id: 8,
      documento_id: 45,
      usuario_id: 12,
      recepcionado: false,
      documento: {
        nombre: 'Procedimiento de prueba',
        tipo: 'Seguridad',
      },
      usuario: {
        nombre: 'Trabajador',
        apellido: 'Prueba',
        correo: 'prueba@example.test',
      },
      save: vi.fn().mockResolvedValue(undefined),
    } as any);

    vi.mocked(generarPDFConfirmacion).mockResolvedValueOnce(
      '/uploads/confirmaciones/../documento-ajeno.pdf'
    );

    vi.mocked(FirmaDigital.create).mockRejectedValueOnce(
      new Error('Error simulado de firma')
    );

    await expect(
      confirmarRecepcionDocumental({
        documentoId: 45,
        usuarioId: 12,
        aceptaDeclaracion: true,
      })
    ).rejects.toThrow('Error simulado de firma');

    expect(transaccion.rollback).toHaveBeenCalledOnce();
    expect(transaccion.commit).not.toHaveBeenCalled();
    expect(fs.unlink).not.toHaveBeenCalled();
  });


  it('revierte la transacción cuando falla la generación del PDF', async () => {
    const transaccion = {
      commit: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined),
      LOCK: { UPDATE: 'UPDATE' },
    };

    vi.mocked(sequelize.transaction).mockResolvedValueOnce(transaccion as any);

    const guardar = vi.fn();

    vi.mocked(RelDocumentoUsuario.findOne).mockResolvedValueOnce({
      id: 8,
      documento_id: 45,
      usuario_id: 12,
      recepcionado: false,
      documento: {
        nombre: 'Procedimiento de prueba',
        tipo: 'Seguridad',
      },
      usuario: {
        nombre: 'Trabajador',
        apellido: 'Prueba',
        correo: 'prueba@example.test',
      },
      save: guardar,
    } as any);

    vi.mocked(generarPDFConfirmacion).mockRejectedValueOnce(
      new Error('Error simulado al generar PDF')
    );

    await expect(
      confirmarRecepcionDocumental({
        documentoId: 45,
        usuarioId: 12,
        aceptaDeclaracion: true,
      })
    ).rejects.toThrow('Error simulado al generar PDF');

    expect(transaccion.rollback).toHaveBeenCalledOnce();
    expect(transaccion.commit).not.toHaveBeenCalled();
    expect(guardar).not.toHaveBeenCalled();
    expect(FirmaDigital.create).not.toHaveBeenCalled();
    expect(fs.unlink).not.toHaveBeenCalled();
  });


  it('conserva el PDF cuando falla el commit', async () => {
    const transaccion = {
      commit: vi.fn().mockRejectedValue(
        new Error('Error simulado durante commit')
      ),
      rollback: vi.fn(),
      LOCK: { UPDATE: 'UPDATE' },
    };

    vi.mocked(sequelize.transaction).mockResolvedValueOnce(transaccion as any);

    vi.mocked(RelDocumentoUsuario.findOne).mockResolvedValueOnce({
      id: 8,
      documento_id: 45,
      usuario_id: 12,
      recepcionado: false,
      documento: {
        nombre: 'Procedimiento de prueba',
        tipo: 'Seguridad',
      },
      usuario: {
        nombre: 'Trabajador',
        apellido: 'Prueba',
        correo: 'prueba@example.test',
      },
      save: vi.fn().mockResolvedValue(undefined),
    } as any);

    vi.mocked(generarPDFConfirmacion).mockResolvedValueOnce(
      '/uploads/confirmaciones/confirmacion_doc_45_usuario_12_1234567890.pdf'
    );

    vi.mocked(FirmaDigital.create).mockResolvedValueOnce({
      id: 99,
    } as any);

    await expect(
      confirmarRecepcionDocumental({
        documentoId: 45,
        usuarioId: 12,
        aceptaDeclaracion: true,
      })
    ).rejects.toThrow('Error simulado durante commit');

    expect(transaccion.commit).toHaveBeenCalledOnce();
    expect(fs.unlink).not.toHaveBeenCalled();
  });


  it('rechaza documentos previamente recepcionados', async () => {
    const transaccion = {
      commit: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined),
      LOCK: { UPDATE: 'UPDATE' },
    };

    vi.mocked(sequelize.transaction).mockResolvedValueOnce(transaccion as any);

    const guardar = vi.fn();

    vi.mocked(RelDocumentoUsuario.findOne).mockResolvedValueOnce({
      id: 8,
      documento_id: 45,
      usuario_id: 12,
      recepcionado: true,
      documento: {
        nombre: 'Procedimiento de prueba',
        tipo: 'Seguridad',
      },
      usuario: {
        nombre: 'Trabajador',
        apellido: 'Prueba',
        correo: 'prueba@example.test',
      },
      save: guardar,
    } as any);

    await expect(
      confirmarRecepcionDocumental({
        documentoId: 45,
        usuarioId: 12,
        aceptaDeclaracion: true,
      })
    ).rejects.toMatchObject({
      estadoHttp: 409,
    });

    expect(transaccion.rollback).toHaveBeenCalledOnce();
    expect(transaccion.commit).not.toHaveBeenCalled();
    expect(guardar).not.toHaveBeenCalled();
    expect(generarPDFConfirmacion).not.toHaveBeenCalled();
    expect(FirmaDigital.create).not.toHaveBeenCalled();
    expect(fs.unlink).not.toHaveBeenCalled();
  });


  it.each([
    ['sin aceptación', undefined],
    ['aceptación rechazada', false],
    ['aceptación como texto', 'true'],
  ])('rechaza la recepción sin aceptación expresa: %s', async (_caso, aceptacion) => {
    await expect(
      confirmarRecepcionDocumental({
        documentoId: 45,
        usuarioId: 12,
        aceptaDeclaracion: aceptacion as boolean,
      })
    ).rejects.toMatchObject({
      estadoHttp: 400,
    });

    expect(sequelize.transaction).not.toHaveBeenCalled();
    expect(RelDocumentoUsuario.findOne).not.toHaveBeenCalled();
    expect(generarPDFConfirmacion).not.toHaveBeenCalled();
    expect(FirmaDigital.create).not.toHaveBeenCalled();
    expect(fs.unlink).not.toHaveBeenCalled();
  });


  it('limpia una constancia nueva con identificador UUID', async () => {
    const transaccion = {
      commit: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined),
      LOCK: { UPDATE: 'UPDATE' },
    };

    vi.mocked(sequelize.transaction).mockResolvedValueOnce(transaccion as any);

    vi.mocked(RelDocumentoUsuario.findOne).mockResolvedValueOnce({
      id: 8,
      documento_id: 45,
      usuario_id: 12,
      recepcionado: false,
      documento: {
        nombre: 'Procedimiento de prueba',
        tipo: 'Seguridad',
      },
      usuario: {
        nombre: 'Trabajador',
        apellido: 'Prueba',
        correo: 'prueba@example.test',
      },
      save: vi.fn().mockResolvedValue(undefined),
    } as any);

    const rutaNueva =
      '/uploads/confirmaciones/confirmacion_doc_45_usuario_12_1793390000000_a1b2c3d4-5678-4abc-8def-123456789abc.pdf';

    vi.mocked(generarPDFConfirmacion).mockResolvedValueOnce(rutaNueva);
    vi.mocked(FirmaDigital.create).mockRejectedValueOnce(
      new Error('Error simulado de firma')
    );

    await expect(
      confirmarRecepcionDocumental({
        documentoId: 45,
        usuarioId: 12,
        aceptaDeclaracion: true,
      })
    ).rejects.toThrow('Error simulado de firma');

    expect(transaccion.rollback).toHaveBeenCalledOnce();
    expect(transaccion.commit).not.toHaveBeenCalled();
    expect(fs.unlink).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(
        'confirmacion_doc_45_usuario_12_1793390000000_a1b2c3d4-5678-4abc-8def-123456789abc.pdf'
      )
    );
  });

});


describe('Protección de avisos posteriores a la recepción', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('conserva la recepción confirmada cuando falla la notificación', async () => {
    const transaccion = {
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      LOCK: { UPDATE: 'UPDATE' },
    };

    vi.mocked(sequelize.transaction).mockResolvedValueOnce(transaccion as any);

    const guardar = vi.fn().mockResolvedValue(undefined);

    vi.mocked(RelDocumentoUsuario.findOne).mockResolvedValueOnce({
      id: 8,
      documento_id: 45,
      usuario_id: 12,
      recepcionado: false,
      documento: {
        nombre: 'Procedimiento de prueba',
        tipo: 'Seguridad',
      },
      usuario: {
        nombre: 'Trabajador',
        apellido: 'Prueba',
        correo: 'prueba@example.test',
      },
      save: guardar,
    } as any);

    vi.mocked(generarPDFConfirmacion).mockResolvedValueOnce(
      '/uploads/confirmaciones/confirmacion_doc_45_usuario_12_1234567890.pdf'
    );

    vi.mocked(FirmaDigital.create).mockResolvedValueOnce({
      id: 99,
    } as any);

    vi.mocked(avisarRecepcionDocumental).mockRejectedValueOnce(
      new Error('Fallo simulado del servicio de notificaciones')
    );

    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const resultado = await confirmarRecepcionDocumental({
        documentoId: 45,
        usuarioId: 12,
        aceptaDeclaracion: true,
      });

      expect(resultado.ruta_constancia_pdf).toContain(
        'confirmacion_doc_45_usuario_12_1234567890.pdf'
      );

      expect(guardar).toHaveBeenCalledOnce();
      expect(FirmaDigital.create).toHaveBeenCalledOnce();
      expect(transaccion.commit).toHaveBeenCalledOnce();
      expect(transaccion.rollback).not.toHaveBeenCalled();
      expect(fs.unlink).not.toHaveBeenCalled();
      expect(avisarRecepcionDocumental).toHaveBeenCalledOnce();

      expect(
        vi.mocked(transaccion.commit).mock.invocationCallOrder[0]
      ).toBeLessThan(
        vi.mocked(avisarRecepcionDocumental).mock.invocationCallOrder[0]
      );

      expect(consola).toHaveBeenCalled();
    } finally {
      consola.mockRestore();
    }
  });

  it('no genera avisos al intentar recepcionar nuevamente un documento', async () => {
    const transaccion = {
      commit: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined),
      LOCK: { UPDATE: 'UPDATE' },
    };

    vi.mocked(sequelize.transaction).mockResolvedValueOnce(transaccion as any);

    vi.mocked(RelDocumentoUsuario.findOne).mockResolvedValueOnce({
      id: 8,
      documento_id: 45,
      usuario_id: 12,
      recepcionado: true,
      documento: {
        nombre: 'Procedimiento de prueba',
        tipo: 'Seguridad',
      },
      usuario: {
        nombre: 'Trabajador',
        apellido: 'Prueba',
      },
    } as any);

    await expect(
      confirmarRecepcionDocumental({
        documentoId: 45,
        usuarioId: 12,
        aceptaDeclaracion: true,
      })
    ).rejects.toMatchObject({
      estadoHttp: 409,
    });

    expect(transaccion.rollback).toHaveBeenCalledOnce();
    expect(transaccion.commit).not.toHaveBeenCalled();
    expect(FirmaDigital.create).not.toHaveBeenCalled();
    expect(generarPDFConfirmacion).not.toHaveBeenCalled();
    expect(avisarRecepcionDocumental).not.toHaveBeenCalled();
  });
});
