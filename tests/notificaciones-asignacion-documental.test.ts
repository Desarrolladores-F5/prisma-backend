import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  Notificacion: {
    findOrCreate: vi.fn(),
  },
  Usuario: {},
  Faena: {},
}));

import { Notificacion } from '../src/models';
import { avisarAsignacionDocumental } from '../src/services/notificacionesAutomaticas.service';

describe('Notificaciones por asignación documental', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const solicitud = {
    documentoId: 8,
    nombreDocumento: 'Uso de extintores',
    destinatariosIds: [31, 23],
  };

  it('crea un aviso personal por cada trabajador', async () => {
    vi.mocked(Notificacion.findOrCreate)
      .mockResolvedValueOnce([{} as any, true])
      .mockResolvedValueOnce([{} as any, true]);

    const cantidad = await avisarAsignacionDocumental(solicitud);

    expect(cantidad).toBe(2);
    expect(Notificacion.findOrCreate).toHaveBeenCalledTimes(2);

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

    expect(Notificacion.findOrCreate).not.toHaveBeenCalled();
  });
});
