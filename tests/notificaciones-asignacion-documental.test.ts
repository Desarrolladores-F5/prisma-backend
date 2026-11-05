import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  Notificacion: {
    findOrCreate: vi.fn(),
  },
  Documento: {
    findByPk: vi.fn(),
  },
  Usuario: {
    findAll: vi.fn(),
  },
  Faena: {},
}));

import { Notificacion, Documento, Usuario } from '../src/models';
import {
  avisarAsignacionDocumental,
} from '../src/services/notificacionesAutomaticas.service';

describe('Notificaciones por asignación documental', () => {
  const solicitud = {
    documentoId: 8,
    nombreDocumento: 'Uso de extintores',
    destinatariosIds: [31, 23],
  };

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(Documento.findByPk).mockResolvedValue({
      get: (campo: string) => campo === 'empresa_id' ? 1 : undefined,
    } as any);

    vi.mocked(Usuario.findAll).mockResolvedValue([
      { id: 31 },
      { id: 23 },
    ] as any);
  });

  it('crea un aviso personal por cada trabajador autorizado', async () => {
    vi.mocked(Notificacion.findOrCreate)
      .mockResolvedValueOnce([{} as any, true])
      .mockResolvedValueOnce([{} as any, true]);

    const cantidad = await avisarAsignacionDocumental(solicitud);

    expect(cantidad).toBe(2);
    expect(Notificacion.findOrCreate).toHaveBeenCalledTimes(2);

    expect(Documento.findByPk).toHaveBeenCalledWith(8, {
      attributes: ['id', 'empresa_id'],
    });

    expect(Usuario.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: [31, 23],
          activo: true,
        },
        include: [
          expect.objectContaining({
            required: true,
            where: {
              empresa_id: 1,
              activo: true,
            },
          }),
        ],
      })
    );

    for (const usuarioId of [31, 23]) {
      expect(Notificacion.findOrCreate).toHaveBeenCalledWith({
        where: {
          usuario_id: usuarioId,
          clave_evento: `asignacion_documental:8:${usuarioId}`,
        },
        defaults: expect.objectContaining({
          usuario_id: usuarioId,
          tipo: 'asignacion_documental',
          origen: 'documentos',
          leido: false,
          activo: true,
        }),
      });
    }
  });

  it('no duplica avisos si el destinatario se repite', async () => {
    vi.mocked(Usuario.findAll).mockResolvedValueOnce([
      { id: 31 },
    ] as any);

    vi.mocked(Notificacion.findOrCreate)
      .mockResolvedValueOnce([{} as any, true]);

    const cantidad = await avisarAsignacionDocumental({
      ...solicitud,
      destinatariosIds: [31, 31],
    });

    expect(cantidad).toBe(1);
    expect(Notificacion.findOrCreate).toHaveBeenCalledOnce();
  });

  it('rechaza identificadores inválidos antes de escribir', async () => {
    await expect(
      avisarAsignacionDocumental({
        ...solicitud,
        destinatariosIds: [31, -1],
      })
    ).rejects.toThrow('Datos de asignación inválidos.');

    expect(Documento.findByPk).not.toHaveBeenCalled();
    expect(Notificacion.findOrCreate).not.toHaveBeenCalled();
  });

  it('rechaza documentos inexistentes antes de notificar', async () => {
    vi.mocked(Documento.findByPk).mockResolvedValueOnce(null);

    await expect(
      avisarAsignacionDocumental(solicitud)
    ).rejects.toThrow(
      'No se pudo validar la empresa propietaria del documento.'
    );

    expect(Usuario.findAll).not.toHaveBeenCalled();
    expect(Notificacion.findOrCreate).not.toHaveBeenCalled();
  });

  it('rechaza destinatarios ajenos a la empresa del documento', async () => {
    vi.mocked(Usuario.findAll).mockResolvedValueOnce([
      { id: 31 },
    ] as any);

    await expect(
      avisarAsignacionDocumental(solicitud)
    ).rejects.toThrow(
      'Uno o más destinatarios están inactivos o fuera de la empresa.'
    );

    expect(Notificacion.findOrCreate).not.toHaveBeenCalled();
  });

  it('rechaza destinatarios inactivos antes de crear avisos', async () => {
    vi.mocked(Usuario.findAll).mockResolvedValueOnce([] as any);

    await expect(
      avisarAsignacionDocumental({
        ...solicitud,
        destinatariosIds: [31],
      })
    ).rejects.toThrow(
      'Uno o más destinatarios están inactivos o fuera de la empresa.'
    );

    expect(Notificacion.findOrCreate).not.toHaveBeenCalled();
  });
});
